/**
 * Extensión de VS Code para el lenguaje Forja (.fa).
 *
 * Punto de entrada de la extensión: registra comandos, barra de estado,
 * terminal dedicada, provisión de tareas, adaptador de depuración (DAP),
 * paneles webview y el resaltado sintáctico propio.
 *
 * Organización del archivo (en orden de aparición):
 *   1. Estado global y constantes.
 *   2. Ciclo de vida (activar / desactivar).
 *   3. Resaltado sintáctico manual (lexer propio en TypeScript).
 *   4. Cliente LSP (servidor `forja-lsp` por stdio).
 *   5. Barra de estado y barra de herramientas.
 *   6. Registro de comandos.
 *   7. Gestión de procesos y recarga en caliente.
 *   8. Depuración (DAP), tareas y utilidades del sistema.
 */

import * as path from 'path';
import * as fs from 'fs';
import { exec, spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import {
    ExtensionContext,
    workspace,
    window,
    commands,
    StatusBarItem,
    StatusBarAlignment,
    Terminal,
    Task,
    TaskDefinition,
    TaskGroup,
    TaskScope,
    TaskProvider,
    CustomExecution,
    Pseudoterminal,
    EventEmitter,
    Uri,
    OutputChannel,
    env,
    QuickPickItem,
    tasks,
    debug,
    DebugAdapterDescriptorFactory,
    DebugAdapterDescriptor,
    DebugAdapterExecutable,
    DebugSession,
    DebugConfigurationProvider,
    DebugConfiguration,
    CancellationToken,
    WorkspaceFolder,
    ViewColumn,
    Selection,
    Range,
    TextEditorRevealType,
    TextEditor,
    TextEditorDecorationType,
    TextDocument,
} from 'vscode';

import { ProveedorDiagramaForja } from './webviews/diagram';

// ======================================================================
// Estado de la recarga en caliente
// ======================================================================

/** Ítem de la barra de estado que refleja si la recarga en caliente está activa. */
let estadoRecargaCaliente: StatusBarItem;

/** Proceso del usuario que la extensión mantiene vivo para la recarga en caliente. */
interface ProcesoEnEjecucion {
    /** Handle del proceso hijo lanzado con `spawn`. */
    proceso: ChildProcess;
    /** Ruta absoluta del archivo `.fa` que se está ejecutando. */
    archivo: string;
    /** Marca de tiempo (epoch en milisegundos) del arranque. */
    momentoInicio: number;
    /** Modo de ejecución con el que se lanzó el proceso. */
    modo: 'run' | 'gui';
}

/** Procesos vivos indexados por la ruta absoluta del archivo en ejecución. */
let procesosEnEjecucion: Map<string, ProcesoEnEjecucion> = new Map();

/** Indica si la recarga automática al guardar está habilitada. */
let recargaCalienteActiva = true;

// ======================================================================
// Constantes
// ======================================================================

/** Nombre del canal de salida que agrupa todos los mensajes de la extensión. */
const NOMBRE_CANAL_SALIDA = 'Forja';

/** Nombre de la terminal integrada dedicada a los comandos de Forja. */
const NOMBRE_TERMINAL = 'Forja';

/** Modos de máquina virtual que admite el ejecutable `forja`. */
type ModoVM = 'fastvm' | 'vm' | 'jit';

/** Plataformas de compilación que admite el ejecutable `forja`. */
type PlataformaObjetivo = 'native'
    | 'x86_64-pc-windows-msvc'
    | 'aarch64-linux-android'
    | 'x86_64-linux-android'
    | 'wasm32-unknown-unknown';

/** Lista ordenada de modos de VM disponibles para el selector rápido. */
const MODOS_VM: ModoVM[] = ['fastvm', 'vm', 'jit'];

/** Lista ordenada de plataformas objetivo disponibles para el selector rápido. */
const PLATAFORMAS: PlataformaObjetivo[] = ['native', 'x86_64-pc-windows-msvc', 'aarch64-linux-android', 'x86_64-linux-android', 'wasm32-unknown-unknown'];

/** Etiqueta legible que se muestra en la barra de estado para cada modo de VM. */
const ETIQUETAS_VM: Record<ModoVM, string> = {
    'fastvm': 'FastVM',
    'vm': 'VM Clásica',
    'jit': 'JIT Nativo',
};

/** Iconos codicon que acompañan a cada modo de VM en la interfaz. */
const ICONOS_VM: Record<ModoVM, string> = {
    'fastvm': '$(zap)',
    'vm': '$(vm)',
    'jit': '$(rocket)',
};

/** Identificadores internos de las tareas que puede ejecutar la extensión. */
type NombreTarea =
    | 'run' | 'run-fast' | 'run-jit' | 'run-aot'
    | 'debug' | 'gui'
    | 'build' | 'build-asm' | 'build-wasm' | 'build-android'
    | 'test' | 'bench'
    | 'fmt' | 'doc' | 'diagram' | 'transpile'
    | 'gui-hot-reload';

// ======================================================================
// Estado
// ======================================================================

/** Cliente del protocolo de servidor de lenguaje (`vscode-languageclient`). */
let clienteLsp: any;

/** Canal de salida compartido por toda la extensión. */
let canalSalida: OutputChannel;

/** Terminal integrada reutilizable; `undefined` cuando no existe todavía. */
let terminalForja: Terminal | undefined;

/** Indicador de la barra de estado con el modo de VM activo. */
let barraEstadoVM: StatusBarItem;

/** Indicador de la barra de estado con la plataforma objetivo activa. */
let barraEstadoObjetivo: StatusBarItem;

/** Modo de VM seleccionado actualmente. */
let modoVMActual: ModoVM = 'fastvm';

/** Plataforma objetivo seleccionada actualmente. */
let objetivoActual: PlataformaObjetivo = 'native';

// ======================================================================
// Ciclo de vida de la extensión
// ======================================================================

/**
 * Activa la extensión.
 *
 * Es el punto de entrada que invoca VS Code. Crea el canal de salida, carga
 * la configuración del usuario, monta el resaltado sintáctico, el cliente LSP,
 * la barra de estado, todos los comandos, el proveedor de tareas, el adaptador
 * de depuración y el panel de diagramas.
 *
 * @param contexto Contexto de la extensión que aporta VS Code (suscripciones y rutas).
 * @returns Nada; los recursos se liberan en `deactivate`.
 */
export function activate(contexto: ExtensionContext) {
    canalSalida = window.createOutputChannel(NOMBRE_CANAL_SALIDA, 'forja');
    canalSalida.appendLine('Extensión Forja activada');

    // ── Carga de la configuración del usuario ──
    modoVMActual = workspace.getConfiguration('forja').get<ModoVM>('defaultVM', 'fastvm');
    objetivoActual = workspace.getConfiguration('forja').get<PlataformaObjetivo>('defaultTarget', 'native');
    recargaCalienteActiva = workspace.getConfiguration('forja').get<boolean>('hotReload.enabled', true);

    // ── Resaltado sintáctico propio ──
    configurarResaltadoForja(contexto);

    // ── Cliente LSP ──
    iniciarClienteLsp(contexto);

    // ── Barra de estado: selector de VM ──
    barraEstadoVM = window.createStatusBarItem(StatusBarAlignment.Left, 100);
    barraEstadoVM.command = 'forja.selectVM';
    barraEstadoVM.tooltip = 'Haz clic para cambiar la VM por defecto';
    contexto.subscriptions.push(barraEstadoVM);

    // ── Barra de estado: selector de plataforma objetivo ──
    barraEstadoObjetivo = window.createStatusBarItem(StatusBarAlignment.Left, 99);
    barraEstadoObjetivo.command = 'forja.selectTarget';
    barraEstadoObjetivo.tooltip = 'Haz clic para cambiar la plataforma target';
    contexto.subscriptions.push(barraEstadoObjetivo);

    // ── Registro de todos los comandos ──
    registrarComandos(contexto);

    // ── Proveedor de tareas ──
    contexto.subscriptions.push(
        tasks.registerTaskProvider('forja', new ProveedorTareasForja())
    );

    // ── Adaptador de depuración (DAP) ──
    contexto.subscriptions.push(
        debug.registerDebugAdapterDescriptorFactory('forja', new FabricaDescriptoresDepuracionForja(contexto))
    );
    contexto.subscriptions.push(
        debug.registerDebugConfigurationProvider('forja', new ProveedorConfiguracionDepuracionForja())
    );

    // ── Panel webview del diagrama ──
    const proveedorDiagrama = new ProveedorDiagramaForja(contexto.extensionUri);
    contexto.subscriptions.push(
        window.registerWebviewViewProvider(ProveedorDiagramaForja.tipoVista, proveedorDiagrama)
    );

    // Refrescar el diagrama al cambiar de editor.
    contexto.subscriptions.push(
        window.onDidChangeActiveTextEditor(() => {
            actualizarVisibilidadBarraHerramientas();
            proveedorDiagrama.actualizarDiagramaActivo();
        })
    );

    // ── Barra de estado: indicador de recarga en caliente ──
    estadoRecargaCaliente = window.createStatusBarItem(StatusBarAlignment.Left, 98);
    estadoRecargaCaliente.command = 'forja.toggleHotReload';
    estadoRecargaCaliente.tooltip = 'Haz clic para activar/desactivar Hot Reload';
    contexto.subscriptions.push(estadoRecargaCaliente);

    // ── Recarga en caliente al guardar un archivo ──
    contexto.subscriptions.push(
        workspace.onDidSaveTextDocument(async (documento) => {
            if (documento.languageId === 'forja') {
                proveedorDiagrama.actualizarDiagramaActivo();
            }
            if (!recargaCalienteActiva) return;
            if (documento.languageId !== 'forja') return;

            const rutaArchivo = documento.fileName;
            canalSalida.appendLine(`Archivo guardado: ${rutaArchivo}`);

            const procesoVivo = procesosEnEjecucion.get(rutaArchivo);
            if (procesoVivo) {
                canalSalida.appendLine(`Hot Reload: ${procesoVivo.modo} → ${rutaArchivo}`);
                await matarProceso(rutaArchivo);
                iniciarProceso(rutaArchivo, procesoVivo.modo);
            }
        })
    );

    // ── Creación de los elementos de la barra de herramientas ──
    for (const elemento of elementosBarraHerramientas) {
        const itemBarra = window.createStatusBarItem(StatusBarAlignment.Left, elemento.prioridad);
        itemBarra.text = elemento.texto;
        itemBarra.command = elemento.comando;
        itemBarra.tooltip = elemento.ayuda;
        elemento.elementoBarraEstado = itemBarra;
        contexto.subscriptions.push(itemBarra);
    }

    // ── Primera actualización de la interfaz ──
    actualizarBarraEstado();
    actualizarVisibilidadBarraHerramientas();

    canalSalida.appendLine('Extensión Forja lista: todos los comandos registrados');
}

/**
 * Desactiva la extensión.
 *
 * Detiene el cliente LSP si estaba activo. VS Code llama a esta función al
 * cerrarse la ventana o al desinstalar la extensión.
 *
 * @returns Promesa que se resuelve cuando el servidor de lenguaje terminó.
 */
export function deactivate(): Thenable<void> | undefined {
    if (clienteLsp) {
        return clienteLsp.stop();
    }
    return undefined;
}

// ======================================================================
// Resaltado sintáctico manual (TextEditorDecorationType)
// ======================================================================

/** Palabras clave del lenguaje reconocidas por el resaltador. */
const PALABRAS_CLAVE = [
    'importar', 'mut', 'si', 'sino', 'o',
    'mientras', 'para', 'repetir', 'funcion', 'fun', 'retornar', 'clase',
    'constructor', 'nuevo', 'prestado', 'tipo', 'coincidir', 'caso', 'BD',
    'externo', 'externa', 'hilo', 'canal', 'enviar', 'recibir', 'unir',
    'rasgo', 'implementa', 'donde', 'seleccionar', 'tiempo', 'otro', 'cuando',
    'requiere', 'asegura', 'siempre', 'resultado', 'anterior', 'continuar',
];

/** Palabras que introducen una declaración de variable o constante. */
const DECLARACIONES = ['variable', 'var', 'constante', 'const'];

/** Nombres de tipo primitivos del lenguaje. */
const TIPOS = ['Entero', 'Decimal', 'Texto', 'Booleano', 'Nulo', 'Exacto'];

/** Literales booleanos y nulo. */
const LITERALES = ['verdadero', 'falso', 'nulo'];

/** Funciones incorporadas de la biblioteca estándar. */
const INCORPORADAS = [
    'escribir', 'leer', 'asegurar', 'longitud', 'aleatorio', 'redondear',
    'potencia', 'raiz', 'maximo', 'minimo', 'concatenar', 'insertar',
    'eliminar', 'contiene', 'claves', 'valores', 'a_caracter', 'a_texto',
    'a_entero', 'a_decimal', 'es_entero', 'es_texto', 'es_decimal',
    'es_booleano', 'es_lista', 'es_mapa', 'es_nulo', 'es_arreglo',
    'tiempo_actual', 'esperar', 'abrir_archivo', 'leer_archivo',
    'escribir_archivo', 'crear_directorio', 'existe_archivo', 'conectar',
    'consultar', 'ejecutar', 'cerrar', 'transaccion', 'guardar',
    'pedir_texto', 'imprimir', 'mayuscula',
];

/** Tipo de resaltado: el tipo de decoración más los rangos acumulados en un pase. */
interface TipoDecoracion {
    /** Tipo de decoración registrado en VS Code. */
    tipo: TextEditorDecorationType;
    /** Rangos que se pintarán en la próxima aplicación. */
    rangos: Range[];
}

/** Caché de tipos de decoración, indexada por categoría léxica (`keyword`, `string`, …). */
let tiposDecoracion: Record<string, TipoDecoracion> = {};

/**
 * Crea (una sola vez) los tipos de decoración del resaltador.
 *
 * Cada categoría léxica se asocia a un color fijo. La función es idempotente:
 * si los tipos ya existen devuelve la caché sin volver a crearlos.
 *
 * @param contexto Contexto de la extensión donde se registran los tipos para su liberación.
 * @returns Mapa de categoría léxica a su tipo de decoración.
 */
function obtenerTiposDecoracion(contexto: ExtensionContext): Record<string, TipoDecoracion> {
    if (Object.keys(tiposDecoracion).length > 0) return tiposDecoracion;

    const colores: Record<string, string> = {
        comment: '#8B8B8B',
        string: '#6AAB73',
        char: '#6AAB73',
        number: '#43A8D6',
        boolean: '#3992D6',
        keyword: '#CC7832',
        declaration: '#B27FB0',
        self: '#B27FB0',
        type: '#43A8D6',
        cls: '#43A8D6',
        fn: '#B5BC68',
        builtin: '#B5BC68',
        operator: '#BCBEC4',
        variable: '#A9B7C6',
        punctuation: '#BCBEC4',
        attribute: '#BBB529',
    };

    for (const [categoria, color] of Object.entries(colores)) {
        const tipo = window.createTextEditorDecorationType({ color });
        tiposDecoracion[categoria] = { tipo, rangos: [] };
        contexto.subscriptions.push(tipo);
    }
    return tiposDecoracion;
}

/**
 * Analiza léxicamente un texto Forja y devuelve sus fichas con posición.
 *
 * Es un lexer simplificado pensado solo para colorear: no valida sintaxis ni
 * informa errores. Cada ficha indica la categoría léxica y el rango de
 * caracteres `[inicio, fin)` que ocupa en el texto.
 *
 * @param texto Contenido completo del documento Forja.
 * @returns Lista de fichas en orden de aparición.
 */
function tokenizarForja(texto: string): { nombre: string; inicio: number; fin: number }[] {
    const fichas: { nombre: string; inicio: number; fin: number }[] = [];
    const longitud = texto.length;
    let indice = 0;

    const esCaracterDePalabra = (caracter: string) => /[a-zA-Z0-9_ñ]/.test(caracter);
    const conjuntoClave = new Set(PALABRAS_CLAVE);
    const conjuntoDeclaracion = new Set(DECLARACIONES);
    const conjuntoTipo = new Set(TIPOS);
    const conjuntoLiteral = new Set(LITERALES);
    const conjuntoIncorporada = new Set(INCORPORADAS);

    while (indice < longitud) {
        const caracter = texto[indice];

        // Atributos: @nombre
        if (caracter === '@') {
            let fin = indice + 1;
            while (fin < longitud && /[a-zA-Z0-9_]/.test(texto[fin])) fin++;
            fichas.push({ nombre: 'attribute', inicio: indice, fin: fin });
            indice = fin;
            continue;
        }

        // Comentario de línea con almohadilla: # ...
        if (caracter === '#') {
            let fin = texto.indexOf('\n', indice);
            if (fin === -1) fin = longitud;
            fichas.push({ nombre: 'comment', inicio: indice, fin: fin });
            indice = fin;
            continue;
        }
        // Comentario de línea con doble barra: // ...
        if (caracter === '/' && texto[indice + 1] === '/') {
            let fin = texto.indexOf('\n', indice);
            if (fin === -1) fin = longitud;
            fichas.push({ nombre: 'comment', inicio: indice, fin: fin });
            indice = fin;
            continue;
        }
        // Comentario de bloque: /* ... */
        if (caracter === '/' && texto[indice + 1] === '*') {
            let fin = texto.indexOf('*/', indice + 2);
            if (fin === -1) fin = longitud; else fin += 2;
            fichas.push({ nombre: 'comment', inicio: indice, fin: fin });
            indice = fin;
            continue;
        }

        // Cadenas de texto: "..." con escapes
        if (caracter === '"') {
            let fin = indice + 1;
            while (fin < longitud) {
                if (texto[fin] === '\\' && fin + 1 < longitud) { fin += 2; continue; }
                if (texto[fin] === '"') { fin++; break; }
                fin++;
            }
            fichas.push({ nombre: 'string', inicio: indice, fin: fin });
            indice = fin;
            continue;
        }

        // Caracteres sueltos: '...' con escapes
        if (caracter === "'") {
            let fin = indice + 1;
            while (fin < longitud) {
                if (texto[fin] === '\\' && fin + 1 < longitud) { fin += 2; continue; }
                if (texto[fin] === "'") { fin++; break; }
                fin++;
            }
            fichas.push({ nombre: 'char', inicio: indice, fin: fin });
            indice = fin;
            continue;
        }

        // Números: dígitos y puntos decimales
        if (/\d/.test(caracter)) {
            let fin = indice + 1;
            while (fin < longitud && /[\d.]/.test(texto[fin])) fin++;
            fichas.push({ nombre: 'number', inicio: indice, fin: fin });
            indice = fin;
            continue;
        }

        // Identificadores, palabras clave y nombres de función
        if (esCaracterDePalabra(caracter) && /[a-zA-Z_ñ]/.test(caracter)) {
            let fin = indice + 1;
            while (fin < longitud && esCaracterDePalabra(texto[fin])) fin++;
            const palabra = texto.substring(indice, fin);

            if (palabra === 'este') {
                fichas.push({ nombre: 'self', inicio: indice, fin: fin });
            } else if (conjuntoDeclaracion.has(palabra)) {
                fichas.push({ nombre: 'declaration', inicio: indice, fin: fin });
            } else if (conjuntoClave.has(palabra)) {
                fichas.push({ nombre: 'keyword', inicio: indice, fin: fin });
            } else if (conjuntoLiteral.has(palabra)) {
                fichas.push({ nombre: 'boolean', inicio: indice, fin: fin });
            } else if (conjuntoTipo.has(palabra)) {
                fichas.push({ nombre: 'type', inicio: indice, fin: fin });
            } else if (conjuntoIncorporada.has(palabra)) {
                fichas.push({ nombre: 'builtin', inicio: indice, fin: fin });
            } else if (/^[A-Z]/.test(palabra)) {
                fichas.push({ nombre: 'cls', inicio: indice, fin: fin });
            } else if (texto[fin] === '(' || (texto[fin] === ' ' && texto[fin + 1] === '(')) {
                fichas.push({ nombre: 'fn', inicio: indice, fin: fin });
            } else {
                fichas.push({ nombre: 'variable', inicio: indice, fin: fin });
            }
            indice = fin;
            continue;
        }

        // Operadores aritméticos, lógicos y de comparación
        if (/[+\-*/%=<>!&|]/.test(caracter)) {
            let fin = indice;
            // Nota: los casos de ':' y '.' son inalcanzables porque el filtro de
            // entrada no los incluye; se conservan para no alterar el comportamiento.
            if (texto[fin] === '-' && texto[fin + 1] === '>') fin += 2;
            else if (texto[fin] === ':' && texto[fin + 1] === ':') fin += 2;
            else if (texto[fin] === '.' && texto[fin + 1] === '.' && texto[fin + 2] === '.') fin += 3;
            else if ((caracter === '=' || caracter === '!' || caracter === '>' || caracter === '<' || caracter === '+' || caracter === '-' || caracter === '*' || caracter === '/' || caracter === '%' || caracter === '&' || caracter === '|') && texto[fin + 1] === '=') fin += 2;
            else if (caracter === '|' && texto[fin + 1] === '|') fin += 2;
            else if (caracter === '&' && texto[fin + 1] === '&') fin += 2;
            else if (caracter === '+' && texto[fin + 1] === '+') fin += 2;
            else if (caracter === '-' && texto[fin + 1] === '-') fin += 2;
            else fin += 1;
            fichas.push({ nombre: 'operator', inicio: indice, fin: fin });
            indice = fin;
            continue;
        }

        // Signos de puntuación de un solo carácter
        if (/[{}()\[\];:,.@?]/.test(caracter)) {
            fichas.push({ nombre: 'punctuation', inicio: indice, fin: indice + 1 });
            indice++;
            continue;
        }

        // Cualquier otro carácter se ignora.
        indice++;
    }

    return fichas;
}

/**
 * Aplica el resaltado a un editor Forja.
 *
 * Reinicia los rangos acumulados, tokeniza el documento activo y vuelca los
 * rangos resultantes en cada tipo de decoración. Solo actúa si el documento
 * pertenece al lenguaje `forja`.
 *
 * @param editor Editor de texto sobre el que se pintan las decoraciones.
 * @returns Nada.
 */
function aplicarDecoracionesForja(editor: TextEditor) {
    if (editor.document.languageId !== 'forja') return;
    const decoraciones = obtenerDecoraciones();

    for (const categoria of Object.keys(decoraciones)) decoraciones[categoria].rangos = [];

    const texto = editor.document.getText();
    const fichas = tokenizarForja(texto);

    for (const ficha of fichas) {
        const decoracion = decoraciones[ficha.nombre];
        if (!decoracion) continue;
        const posicionInicio = editor.document.positionAt(ficha.inicio);
        const posicionFin = editor.document.positionAt(ficha.fin);
        decoracion.rangos.push(new Range(posicionInicio, posicionFin));
    }

    for (const categoria of Object.keys(decoraciones)) {
        editor.setDecorations(decoraciones[categoria].tipo, decoraciones[categoria].rangos);
    }
}

/**
 * Quita todas las decoraciones del resaltador de un editor.
 *
 * @param editor Editor del que se retiran las decoraciones.
 * @returns Nada.
 */
function limpiarDecoracionesForja(editor: TextEditor) {
    const decoraciones = tiposDecoracion;
    for (const categoria of Object.keys(decoraciones)) {
        editor.setDecorations(decoraciones[categoria].tipo, []);
    }
}

/**
 * Devuelve la caché de tipos de decoración del resaltador.
 *
 * @returns Mapa de categoría léxica a su tipo de decoración.
 */
function obtenerDecoraciones(): Record<string, TipoDecoracion> {
    return tiposDecoracion;
}

/**
 * Instala el resaltador sintáctico propio.
 *
 * Crea los tipos de decoración, pinta el editor activo y se suscribe a los
 * eventos de cambio de editor y de cambio de texto (con retardo de 100 ms para
 * no tokenizar en cada pulsación).
 *
 * @param contexto Contexto de la extensión donde se registran las suscripciones.
 * @returns Nada.
 */
function configurarResaltadoForja(contexto: ExtensionContext) {
    obtenerTiposDecoracion(contexto);

    // Pintar el editor que ya esté abierto al activarse.
    if (window.activeTextEditor) {
        aplicarDecoracionesForja(window.activeTextEditor);
    }

    // Repintar al cambiar de editor.
    contexto.subscriptions.push(
        window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                if (editor.document.languageId === 'forja') {
                    aplicarDecoracionesForja(editor);
                } else {
                    limpiarDecoracionesForja(editor);
                }
            }
        })
    );

    // Repintar al modificar el texto (con retardo para agrupar pulsaciones).
    let temporizadorEspera: NodeJS.Timeout | undefined;
    contexto.subscriptions.push(
        workspace.onDidChangeTextDocument((evento) => {
            const editor = window.activeTextEditor;
            if (!editor || editor.document !== evento.document) return;
            if (editor.document.languageId !== 'forja') return;
            if (temporizadorEspera) clearTimeout(temporizadorEspera);
            temporizadorEspera = setTimeout(() => aplicarDecoracionesForja(editor), 100);
        })
    );
}

// ======================================================================
// Cliente LSP
// ======================================================================

/**
 * Arranca el cliente del servidor de lenguaje (`forja-lsp`).
 *
 * Respeta la configuración `forja.lsp.enabled` y `forja.lsp.path`. Si no hay
 * ruta configurada busca el binario en `target/debug`, luego en
 * `target/release` y por último en el `PATH`. Si no lo encuentra, deja la
 * extensión funcionando solo con el resaltador propio.
 *
 * @param contexto Contexto de la extensión usado para resolver rutas relativas.
 * @returns Nada.
 */
function iniciarClienteLsp(contexto: ExtensionContext) {
    const lspHabilitado = workspace.getConfiguration('forja').get<boolean>('lsp.enabled', true);
    if (!lspHabilitado) {
        canalSalida.appendLine('LSP deshabilitado por configuración');
        return;
    }

    let ClienteLenguaje: any, TipoTransporte: any;

    try {
        const lsp = require('vscode-languageclient/node');
        ClienteLenguaje = lsp.LanguageClient;
        TipoTransporte = lsp.TransportKind;
    } catch {
        canalSalida.appendLine('vscode-languageclient no disponible — LSP deshabilitado, el resaltador sigue activo');
        return;
    }

    // Resolución de la ruta del servidor: configuración explícita o autodetección.
    let rutaServidor = workspace.getConfiguration('forja').get<string>('lsp.path', '');
    if (!rutaServidor) {
        // Primero el binario de desarrollo del proyecto.
        const rutaRelativa = contexto.asAbsolutePath(path.join('..', 'target', 'debug', 'forja-lsp.exe'));
        if (fs.existsSync(rutaRelativa)) {
            rutaServidor = rutaRelativa;
        } else {
            // Después el binario de release.
            const rutaRelativaRelease = contexto.asAbsolutePath(path.join('..', 'target', 'release', 'forja-lsp.exe'));
            if (fs.existsSync(rutaRelativaRelease)) {
                rutaServidor = rutaRelativaRelease;
            } else {
                // Por último, el PATH del sistema.
                const resultadoBusqueda = buscarEnRuta('forja-lsp');
                if (resultadoBusqueda) {
                    rutaServidor = resultadoBusqueda;
                } else {
                    canalSalida.appendLine('forja-lsp no encontrado. LSP deshabilitado.');
                    return;
                }
            }
        }
    }

    const opcionesServidor = {
        run: { command: rutaServidor, transport: TipoTransporte.stdio },
        debug: { command: rutaServidor, transport: TipoTransporte.stdio },
    };

    const opcionesCliente = {
        documentSelector: [{ scheme: 'file', language: 'forja' }],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher('**/*.fa'),
        },
        outputChannel: canalSalida,
        traceOutputChannel: canalSalida,
    };

    clienteLsp = new ClienteLenguaje('forja-lsp', 'Forja Language Server', opcionesServidor, opcionesCliente);
    clienteLsp.start();
    canalSalida.appendLine(`Cliente LSP iniciado: ${rutaServidor}`);
}

// ======================================================================
// Barra de estado y barra de herramientas
// ======================================================================

/** Elemento configurable de la barra de herramientas inferior. */
interface ElementoBarraHerramientas {
    /** Identificador interno del elemento. */
    id: string;
    /** Texto visible (admite codicons). */
    texto: string;
    /** Comando de VS Code que se dispara al pulsarlo. */
    comando: string;
    /** Texto de ayuda emergente. */
    ayuda: string;
    /** Prioridad de ordenación; mayor valor aparece más a la izquierda. */
    prioridad: number;
    /** Elemento real de la barra de estado, asignado durante la activación. */
    elementoBarraEstado?: StatusBarItem;
}

/** Elementos de la barra de herramientas; se completan durante la activación. */
let elementosBarraHerramientas: ElementoBarraHerramientas[] = [
    { id: 'runFast', texto: '$(zap) Ejecutar', comando: 'forja.runFast', ayuda: 'Ejecutar con FastVM', prioridad: 105 },
    { id: 'runDebug', texto: '$(bug) Debug', comando: 'forja.runDebug', ayuda: 'Iniciar depuración (DAP)', prioridad: 104 },
    { id: 'hotReload', texto: '$(sync) Reload', comando: 'forja.hotReload', ayuda: 'Recarga en caliente (Hot Reload)', prioridad: 103 },
    { id: 'hotRestart', texto: '$(refresh) Restart', comando: 'forja.hotRestart', ayuda: 'Reinicio en caliente (Hot Restart)', prioridad: 102 },
    { id: 'runAOT', texto: '$(tools) AOT', comando: 'forja.runAOT', ayuda: 'Compilar AOT y ejecutar', prioridad: 101 },
    { id: 'buildAndroid', texto: '$(device-mobile) Android', comando: 'forja.buildAndroid', ayuda: 'Compilar para Android', prioridad: 100 },
];

/**
 * Muestra u oculta los elementos de la barra de herramientas.
 *
 * La barra solo aparece cuando el editor activo contiene un archivo Forja.
 *
 * @returns Nada.
 */
function actualizarVisibilidadBarraHerramientas() {
    const editor = window.activeTextEditor;
    const esForja = editor && editor.document.languageId === 'forja';

    for (const elemento of elementosBarraHerramientas) {
        if (elemento.elementoBarraEstado) {
            if (esForja) {
                elemento.elementoBarraEstado.show();
            } else {
                elemento.elementoBarraEstado.hide();
            }
        }
    }
}

/**
 * Refresca la barra de estado completa.
 *
 * Actualiza el modo de VM, la plataforma objetivo y el indicador de recarga
 * en caliente.
 *
 * @returns Nada.
 */
function actualizarBarraEstado() {
    barraEstadoVM.text = `${ICONOS_VM[modoVMActual]} ${ETIQUETAS_VM[modoVMActual]}`;
    barraEstadoVM.show();

    const etiquetaObjetivo = objetivoActual === 'native' ? 'Nativo'
        : objetivoActual === 'wasm32-unknown-unknown' ? 'WASM'
            : objetivoActual.includes('android') ? 'Android'
                : objetivoActual;
    barraEstadoObjetivo.text = `$(target) ${etiquetaObjetivo}`;
    barraEstadoObjetivo.show();

    // Indicador de recarga en caliente: apagado, procesos vivos o en espera.
    if (estadoRecargaCaliente) {
        const cantidad = procesosEnEjecucion.size;
        if (!recargaCalienteActiva) {
            estadoRecargaCaliente.text = '$(circle-slash) HR off';
        } else if (cantidad > 0) {
            estadoRecargaCaliente.text = `$(sync) HR ${cantidad}`;
        } else {
            estadoRecargaCaliente.text = '$(circle-outline) HR';
        }
        estadoRecargaCaliente.show();
    }
}

// ======================================================================
// Registro de comandos
// ======================================================================

/**
 * Registra todos los comandos que aporta la extensión.
 *
 * Agrupa ejecución, compilación, cross-compilación a Android, pruebas,
 * herramientas, recarga en caliente, creación de proyectos y selectores de
 * VM/plataforma. Cada comando se añade a las suscripciones para liberarlo al
 * desactivar la extensión.
 *
 * @param contexto Contexto de la extensión donde se registran los comandos.
 * @returns Nada.
 */
function registrarComandos(contexto: ExtensionContext) {
    // ── Comandos de ejecución ──

    // Ejecutar con la VM original.
    const comandoEjecutar = commands.registerCommand('forja.run', () => {
        ejecutarOrden('run', ['run']);
    });
    contexto.subscriptions.push(comandoEjecutar);

    // Ejecutar con FastVM.
    const comandoEjecutarRapido = commands.registerCommand('forja.runFast', () => {
        ejecutarOrden('run', ['run', '--fast']);
    });
    contexto.subscriptions.push(comandoEjecutarRapido);

    // Ejecutar con JIT.
    const comandoEjecutarJit = commands.registerCommand('forja.runJIT', () => {
        ejecutarOrden('run', ['run', '--jit']);
    });
    contexto.subscriptions.push(comandoEjecutarJit);

    // Ejecutar con AOT (LLVM).
    const comandoEjecutarAot = commands.registerCommand('forja.runAOT', () => {
        ejecutarOrden('run', ['run', '--aot']);
    });
    contexto.subscriptions.push(comandoEjecutarAot);

    // Depurar el archivo activo mediante DAP (no por terminal).
    const comandoDepurar = commands.registerCommand('forja.runDebug', () => {
        const editor = window.activeTextEditor;
        if (!editor) {
            window.showErrorMessage('No hay ningún editor activo');
            return;
        }
        if (editor.document.languageId !== 'forja') {
            window.showErrorMessage('El archivo activo no es un archivo Forja (.fa)');
            return;
        }
        debug.startDebugging(workspace.workspaceFolders?.[0], {
            type: 'forja',
            name: 'Forja: Debug archivo activo',
            request: 'launch',
            program: editor.document.fileName,
        });
    });
    contexto.subscriptions.push(comandoDepurar);

    // Ejecutar con interfaz gráfica.
    const comandoEjecutarGui = commands.registerCommand('forja.runGUI', () => {
        ejecutarOrden('run', ['run', '--gui']);
    });
    contexto.subscriptions.push(comandoEjecutarGui);

    // Abrir el panel lateral de diagramas.
    const comandoAbrirDiagrama = commands.registerCommand('forja.openDiagram', () => {
        commands.executeCommand('workbench.view.extension.forja-sidebar');
    });
    contexto.subscriptions.push(comandoAbrirDiagrama);

    // Alternar el panel lateral de diagramas.
    const comandoAlternarLateral = commands.registerCommand('forja.toggleSidebar', () => {
        commands.executeCommand('workbench.view.extension.forja-sidebar');
    });
    contexto.subscriptions.push(comandoAlternarLateral);

    // ── Comandos de compilación ──

    // Compilar a bytecode.
    const comandoCompilar = commands.registerCommand('forja.build', () => {
        ejecutarOrden('build', ['build']);
    });
    contexto.subscriptions.push(comandoCompilar);

    // Compilar a ensamblador.
    const comandoCompilarAsm = commands.registerCommand('forja.buildASM', () => {
        ejecutarOrden('build-asm', ['build', '--asm']);
    });
    contexto.subscriptions.push(comandoCompilarAsm);

    // Compilar a WebAssembly.
    const comandoCompilarWasm = commands.registerCommand('forja.buildWASM', () => {
        ejecutarOrden('build-wasm', ['build', '--target', 'wasm32-unknown-unknown']);
    });
    contexto.subscriptions.push(comandoCompilarWasm);

    // ── Cross-compilación a Android ──

    /**
     * Ejecuta un script del directorio `scripts/` en una terminal dedicada.
     *
     * @param script Nombre del archivo de script (por ejemplo `build-android.sh`).
     * @param argumentos Argumentos adicionales que se pasan al script.
     * @returns Nada.
     */
    function ejecutarScriptAndroid(script: string, argumentos: string[] = []) {
        const rutaScript = path.join(contexto.extensionPath, 'scripts', script);
        if (!fs.existsSync(rutaScript)) {
            window.showErrorMessage(`Script no encontrado: ${rutaScript}`);
            return;
        }
        const comando = `bash "${rutaScript}"${argumentos.length > 0 ? ' ' + argumentos.join(' ') : ''}`;
        const terminal = window.createTerminal({ name: 'Forja Android', cwd: contexto.extensionPath });
        terminal.sendText(comando);
        terminal.show();
    }

    // Compilar para Android ARM64.
    const comandoCompilarAndroid = commands.registerCommand('forja.buildAndroid', () => {
        ejecutarScriptAndroid('build-android.sh', ['aarch64-linux-android']);
    });
    contexto.subscriptions.push(comandoCompilarAndroid);

    // Compilar para Android ARM64 (explícito).
    const comandoCompilarAndroidArm64 = commands.registerCommand('forja.buildAndroid.arm64', () => {
        ejecutarScriptAndroid('build-android.sh', ['aarch64-linux-android']);
    });
    contexto.subscriptions.push(comandoCompilarAndroidArm64);

    // Compilar para Android x86_64.
    const comandoCompilarAndroidX86 = commands.registerCommand('forja.buildAndroid.x86_64', () => {
        ejecutarScriptAndroid('build-android.sh', ['x86_64-linux-android']);
    });
    contexto.subscriptions.push(comandoCompilarAndroidX86);

    // Compilar para todas las arquitecturas Android.
    const comandoCompilarAndroidTodo = commands.registerCommand('forja.buildAndroid.all', () => {
        ejecutarScriptAndroid('build-android.sh', []);
    });
    contexto.subscriptions.push(comandoCompilarAndroidTodo);

    // Verificar la instalación del NDK de Android.
    const comandoVerificarNdk = commands.registerCommand('forja.checkAndroidNDK', () => {
        ejecutarScriptAndroid('toolchain-android.sh', ['check']);
    });
    contexto.subscriptions.push(comandoVerificarNdk);

    // Desplegar el binario compilado en un dispositivo Android por ADB.
    const comandoDesplegarAndroid = commands.registerCommand('forja.deployAndroid', async () => {
        // Detectar primero un dispositivo conectado.
        const rutaAdb = buscarEnRuta('adb');
        if (!rutaAdb) {
            window.showErrorMessage(
                'ADB no encontrado en PATH. Instala Android Platform Tools o agregalo la dirección en PATH.',
                'Entendido'
            );
            return;
        }

        canalSalida.appendLine('Detectando dispositivos Android...');
        exec('adb devices', (error: Error | null, salida: string) => {
            if (error) {
                window.showErrorMessage(`Error ejecutando ADB: ${error.message}`);
                return;
            }
            const lineas = salida.trim().split('\n').filter(linea => linea.includes('\tdevice'));
            if (lineas.length === 0) {
                window.showErrorMessage(
                    'No se detectaron dispositivos Android conectados.',
                    'Entendido'
                );
                return;
            }

            const idDispositivo = lineas[0].split('\t')[0];
            canalSalida.appendLine(`Dispositivo detectado: ${idDispositivo}`);

            // Pedir al usuario la ruta del binario compilado.
            window.showInputBox({
                prompt: 'Ruta al binario Forja compilado para Android',
                placeHolder: 'target/aarch64-linux-android/release/forja.exe',
            }).then(rutaBinario => {
                if (!rutaBinario) return;

                const rutaRemota = `/data/local/tmp/forja`;
                const comandoEnvio = `adb -s ${idDispositivo} push "${rutaBinario}" ${rutaRemota}`;
                const comandoPermisos = `adb -s ${idDispositivo} shell chmod +x ${rutaRemota}`;

                const terminal = window.createTerminal({ name: 'Forja ADB Deploy' });
                terminal.sendText(`${comandoEnvio} && ${comandoPermisos} && echo "Deploy completo: ${rutaRemota}"`);
                terminal.show();
            });
        });
    });
    contexto.subscriptions.push(comandoDesplegarAndroid);

    // ── Pruebas y benchmarks ──

    const comandoPruebas = commands.registerCommand('forja.test', () => {
        ejecutarOrden('test', ['test']);
    });
    contexto.subscriptions.push(comandoPruebas);

    const comandoBenchmark = commands.registerCommand('forja.bench', () => {
        ejecutarOrden('bench', ['bench']);
    });
    contexto.subscriptions.push(comandoBenchmark);

    // ── Herramientas ──

    // Formatear el archivo activo.
    const comandoFormatear = commands.registerCommand('forja.fmt', () => {
        ejecutarOrden('fmt', ['fmt']);
    });
    contexto.subscriptions.push(comandoFormatear);

    // Generar documentación.
    const comandoDocumentar = commands.registerCommand('forja.doc', () => {
        ejecutarOrden('doc', ['doc']);
    });
    contexto.subscriptions.push(comandoDocumentar);

    // Generar el diagrama de flujo.
    const comandoDiagrama = commands.registerCommand('forja.diagram', () => {
        ejecutarOrden('diagram', ['diagram']);
    });
    contexto.subscriptions.push(comandoDiagrama);

    // Transpilar a Rust.
    const comandoTranspilar = commands.registerCommand('forja.transpile', () => {
        ejecutarOrden('transpile', ['transpile']);
    });
    contexto.subscriptions.push(comandoTranspilar);

    // ── Recarga en caliente y reinicio ──

    // Relanzar el archivo activo matando el proceso anterior.
    const comandoRecargaCaliente = commands.registerCommand('forja.hotReload', async () => {
        const editor = window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'forja') {
            window.showErrorMessage('No hay un archivo Forja activo');
            return;
        }
        const rutaArchivo = editor.document.fileName;
        const procesoVivo = procesosEnEjecucion.get(rutaArchivo);
        if (procesoVivo) {
            canalSalida.appendLine(`Hot Reload forzado: ${rutaArchivo}`);
            await matarProceso(rutaArchivo);
            iniciarProceso(rutaArchivo, procesoVivo.modo);
        } else {
            // No había proceso: se arranca uno nuevo en modo ejecución.
            iniciarProceso(rutaArchivo, 'run');
        }
    });
    contexto.subscriptions.push(comandoRecargaCaliente);

    // Matar todos los procesos vivos.
    const comandoReinicioCaliente = commands.registerCommand('forja.hotRestart', async () => {
        const cantidad = procesosEnEjecucion.size;
        if (cantidad === 0) {
            window.showInformationMessage('No hay procesos activos para reiniciar');
            return;
        }
        canalSalida.appendLine(`Hot Restart: reiniciando ${cantidad} proceso(s)`);
        for (const [archivo] of procesosEnEjecucion) {
            await matarProceso(archivo);
            // Cada proceso se relanzará cuando se guarde su archivo.
        }
        window.showInformationMessage(`Se reiniciaron ${cantidad} proceso(s). Guarda los archivos para re-ejecutar.`);
    });
    contexto.subscriptions.push(comandoReinicioCaliente);

    // Activar o desactivar la recarga en caliente.
    const comandoAlternarRecarga = commands.registerCommand('forja.toggleHotReload', () => {
        recargaCalienteActiva = !recargaCalienteActiva;
        workspace.getConfiguration('forja').update('hotReload.enabled', recargaCalienteActiva, true);
        const mensaje = recargaCalienteActiva ? 'Hot Reload activado' : 'Hot Reload desactivado';
        window.showInformationMessage(mensaje);
        canalSalida.appendLine(mensaje);
        actualizarBarraEstado();
    });
    contexto.subscriptions.push(comandoAlternarRecarga);

    // ── Proyecto y toolchain ──

    // Crear un proyecto Forja nuevo en la raíz del espacio de trabajo.
    const comandoNuevoProyecto = commands.registerCommand('forja.newProject', async () => {
        const nombreCarpeta = await window.showInputBox({
            prompt: 'Nombre del nuevo proyecto Forja',
            placeHolder: 'mi-proyecto',
            validateInput: (valor) => {
                if (!valor || valor.trim().length === 0) {
                    return 'El nombre no puede estar vacío';
                }
                if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(valor)) {
                    return 'Usa solo letras, números, guiones y guiones bajos';
                }
                return null;
            },
        });
        if (nombreCarpeta) {
            const uriDestino = workspace.workspaceFolders?.[0]?.uri;
            if (uriDestino) {
                const rutaProyecto = path.join(uriDestino.fsPath, nombreCarpeta);
                obtenerOCrearTerminal().sendText(`forja new "${rutaProyecto}"`);
                obtenerOCrearTerminal().show();
            } else {
                window.showErrorMessage('No hay ninguna carpeta de workspace abierta');
            }
        }
    });
    contexto.subscriptions.push(comandoNuevoProyecto);

    // Compilar la toolchain local con las características de LSP y DAP.
    const comandoInstalarToolchain = commands.registerCommand('forja.installToolchain', () => {
        const terminal = window.createTerminal('Forja Toolchain');
        terminal.sendText('cargo build --features lsp,dap');
        terminal.sendText('');
        terminal.sendText('echo "Si necesitas Android NDK, instala Android Studio o configura ANDROID_NDK_HOME"');
        terminal.show();
    });
    contexto.subscriptions.push(comandoInstalarToolchain);

    // ── Selectores de VM y plataforma ──

    // Selector rápido del modo de VM por defecto.
    const comandoSeleccionarVM = commands.registerCommand('forja.selectVM', async () => {
        const opciones: (QuickPickItem & { value: ModoVM })[] = MODOS_VM.map((modo) => ({
            label: `${ICONOS_VM[modo]} ${ETIQUETAS_VM[modo]}`,
            description: modo === 'fastvm' ? 'Por defecto, ultra-rápida'
                : modo === 'vm' ? 'VM original, estable'
                    : 'Compilación JIT nativa con fallback',
            value: modo,
        }));

        const seleccion = await window.showQuickPick(opciones, {
            placeHolder: 'Seleccionar VM por defecto',
        });

        if (seleccion) {
            modoVMActual = seleccion.value;
            await workspace.getConfiguration('forja').update('defaultVM', seleccion.value, true);
            actualizarBarraEstado();
            canalSalida.appendLine(`VM cambiada a: ${seleccion.value}`);

            window.showInformationMessage(`VM por defecto cambiada a: ${ETIQUETAS_VM[seleccion.value]}`, 'OK');
        }
    });
    contexto.subscriptions.push(comandoSeleccionarVM);

    // Selector rápido de la plataforma objetivo.
    const comandoSeleccionarObjetivo = commands.registerCommand('forja.selectTarget', async () => {
        const opciones: (QuickPickItem & { value: PlataformaObjetivo })[] = PLATAFORMAS.map((objetivo) => ({
            label: `$(target) ${objetivo}`,
            description: objetivo === 'native' ? 'Plataforma actual (por defecto)'
                : objetivo === 'wasm32-unknown-unknown' ? 'WebAssembly'
                    : objetivo.includes('android') ? 'Android (cross-compile)'
                        : 'Windows MSVC',
            value: objetivo,
        }));

        const seleccion = await window.showQuickPick(opciones, {
            placeHolder: 'Seleccionar plataforma target',
        });

        if (seleccion) {
            objetivoActual = seleccion.value;
            await workspace.getConfiguration('forja').update('defaultTarget', seleccion.value, true);
            actualizarBarraEstado();
            canalSalida.appendLine(`Target cambiado a: ${seleccion.value}`);
            window.showInformationMessage(`Target cambiado a: ${seleccion.value}`, 'OK');
        }
    });
    contexto.subscriptions.push(comandoSeleccionarObjetivo);

    // Mostrar el canal de salida.
    const comandoMostrarSalida = commands.registerCommand('forja.showOutput', () => {
        canalSalida.show();
    });
    contexto.subscriptions.push(comandoMostrarSalida);
}

// ======================================================================
// Gestión de procesos (recarga en caliente)
// ======================================================================

/**
 * Mata el proceso asociado a un archivo y lo elimina del registro.
 *
 * En Windows usa `taskkill` con `/t` para matar también los procesos hijos;
 * en el resto de plataformas envía `SIGTERM` y, si no responde en 2 s,
 * `SIGKILL`. Nunca rechaza: siempre resuelve, incluso si el proceso ya no existe.
 *
 * @param rutaArchivo Ruta absoluta del archivo `.fa` cuyo proceso se quiere matar.
 * @returns Promesa que se resuelve cuando el proceso terminó o se dio por terminado.
 */
function matarProceso(rutaArchivo: string): Promise<void> {
    return new Promise((resolver) => {
        const entrada = procesosEnEjecucion.get(rutaArchivo);
        if (!entrada) { resolver(); return; }
        const { proceso } = entrada;
        procesosEnEjecucion.delete(rutaArchivo);
        actualizarBarraEstado();

        try {
            if (process.platform === 'win32') {
                // En Windows `taskkill` es más fiable que enviar señales.
                const matar = spawn('taskkill', ['/pid', String(proceso.pid), '/f', '/t']);
                matar.on('close', () => resolver());
                matar.on('error', () => resolver());
                setTimeout(resolver, 1000);
            } else {
                proceso.kill('SIGTERM');
                setTimeout(() => {
                    try { proceso.kill('SIGKILL'); } catch { }
                    resolver();
                }, 2000);
            }
        } catch {
            resolver();
        }
    });
}

/**
 * Lanza un proceso `forja run` sobre un archivo y lo registra para la recarga.
 *
 * Si ya había un proceso para ese archivo lo mata primero. El modo de VM y el
 * modo gráfico se traducen a banderas de línea de órdenes. La salida estándar
 * y la de error se vuelcan al canal de salida de la extensión.
 *
 * @param rutaArchivo Ruta absoluta del archivo `.fa` que se quiere ejecutar.
 * @param modo Modo de ejecución: `run` para consola, `gui` para interfaz gráfica.
 * @returns Nada.
 */
function iniciarProceso(rutaArchivo: string, modo: 'run' | 'gui') {
    // Si ya había un proceso para este archivo, se mata antes de relanzar.
    if (procesosEnEjecucion.has(rutaArchivo)) {
        matarProceso(rutaArchivo);
    }

    const comando = 'forja';
    const banderaVM = modoVMActual === 'fastvm' ? '--fast' : modoVMActual === 'jit' ? '--jit' : '';
    const banderaModo = modo === 'gui' ? '--gui' : '';
    const argumentos = ['run', banderaVM, banderaModo, `"${rutaArchivo}"`].filter(Boolean);

    const procesoHijo = spawn(comando, argumentos, {
        cwd: path.dirname(rutaArchivo),
        windowsHide: true,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const entrada: ProcesoEnEjecucion = {
        proceso: procesoHijo,
        archivo: rutaArchivo,
        momentoInicio: Date.now(),
        modo: modo,
    };

    procesosEnEjecucion.set(rutaArchivo, entrada);
    actualizarBarraEstado();

    canalSalida.appendLine(`Proceso iniciado: ${comando} ${argumentos.join(' ')} (PID: ${procesoHijo.pid})`);

    procesoHijo.stdout?.on('data', (datos: string | Buffer) => {
        canalSalida.append(datos.toString());
    });

    procesoHijo.stderr?.on('data', (datos: string | Buffer) => {
        canalSalida.append(`[${modo}] ${datos.toString()}`);
    });

    procesoHijo.on('close', (codigo: number | null) => {
        // Solo se limpia el registro si esta entrada sigue siendo la vigente.
        if (procesosEnEjecucion.get(rutaArchivo)?.proceso === procesoHijo) {
            procesosEnEjecucion.delete(rutaArchivo);
            actualizarBarraEstado();
        }
        canalSalida.appendLine(`Proceso terminado (PID: ${procesoHijo.pid}, codigo: ${codigo})`);
    });

    procesoHijo.on('error', (error: Error) => {
        canalSalida.appendLine(`Error iniciando proceso: ${error.message}`);
        if (procesosEnEjecucion.get(rutaArchivo)?.proceso === procesoHijo) {
            procesosEnEjecucion.delete(rutaArchivo);
            actualizarBarraEstado();
        }
    });
}

// ======================================================================
// Ejecución de órdenes de la CLI
// ======================================================================

/**
 * Ejecuta una orden de la CLI `forja` sobre el archivo activo.
 *
 * Comprueba que haya un editor activo y que sea un archivo Forja, compone la
 * línea de órdenes con los argumentos de configuración (`forja.buildArgs`) y
 * la envía a la terminal dedicada.
 *
 * @param nombreTarea Identificador interno de la tarea que se ejecuta.
 * @param argumentos Argumentos base de la CLI, sin la ruta del archivo.
 * @returns Nada.
 */
function ejecutarOrden(nombreTarea: NombreTarea, argumentos: string[]) {
    const editor = window.activeTextEditor;
    if (!editor) {
        window.showErrorMessage('No hay ningún editor activo');
        return;
    }

    const documento = editor.document;
    if (documento.languageId !== 'forja') {
        window.showErrorMessage('El archivo activo no es un archivo Forja (.fa)');
        return;
    }

    // Composición de la línea de órdenes final.
    const rutaArchivo = documento.fileName;
    const argumentosExtra = workspace.getConfiguration('forja').get<string>('buildArgs', '');
    const todosLosArgumentos = [...argumentos, `"${rutaArchivo}"`, argumentosExtra].filter(a => a).join(' ');

    const comando = `forja ${todosLosArgumentos}`;
    const terminal = obtenerOCrearTerminal();

    // Vaciar la terminal si el usuario lo pidió.
    if (workspace.getConfiguration('forja').get<boolean>('terminal.clearBeforeRun', false)) {
        terminal.sendText(undefined as any); // `undefined` vacía la terminal.
    }

    if (workspace.getConfiguration('forja').get<boolean>('terminal.preserveFocus', false)) {
        terminal.sendText(comando);
    } else {
        terminal.sendText(comando);
        terminal.show();
    }

    canalSalida.appendLine(`Ejecutando: ${comando}`);
}

/**
 * Devuelve la terminal dedicada de Forja, creándola si aún no existe.
 *
 * Registra el cierre de la terminal para volver a crearla cuando el usuario la
 * elimine.
 *
 * @returns La terminal dedicada, reutilizada entre llamadas.
 */
function obtenerOCrearTerminal(): Terminal {
    if (terminalForja === undefined) {
        terminalForja = window.createTerminal(NOMBRE_TERMINAL);
        window.onDidCloseTerminal((terminal) => {
            if (terminal.name === NOMBRE_TERMINAL) {
                terminalForja = undefined;
            }
        });
    }
    return terminalForja;
}

// ======================================================================
// Depuración (DAP)
// ======================================================================

/**
 * Fábrica de descriptores del adaptador de depuración.
 *
 * Localiza el binario `forja-dap` y crea un descriptor que lo ejecuta como
 * adaptador al que se conecta VS Code.
 */
class FabricaDescriptoresDepuracionForja implements DebugAdapterDescriptorFactory {
    /**
     * @param contexto Contexto de la extensión usado para resolver rutas.
     */
    constructor(private contexto: ExtensionContext) { }

    /**
     * Crea el descriptor del adaptador de depuración.
     *
     * @param _sesion Sesión de depuración que se está creando (no se usa).
     * @returns Descriptor que ejecuta `forja-dap`, o `undefined` si no se encontró.
     */
    createDebugAdapterDescriptor(_sesion: DebugSession): DebugAdapterDescriptor | undefined {
        const rutaDap = buscarBinarioDap(this.contexto);
        if (!rutaDap) {
            const mensaje = 'forja-dap no encontrado. Compila con: cargo build --features dap';
            canalSalida.appendLine('[ADVERTENCIA] ' + mensaje);
            window.showErrorMessage(mensaje, 'Entendido');
            return undefined;
        }
        canalSalida.appendLine(`Binario DAP: ${rutaDap}`);
        return new DebugAdapterExecutable(rutaDap, []);
    }
}

/**
 * Proveedor de configuraciones de depuración.
 *
 * Aporta una configuración de lanzamiento por defecto y resuelve el programa a
 * depurar tomándolo del editor activo cuando el usuario no lo indica.
 */
class ProveedorConfiguracionDepuracionForja implements DebugConfigurationProvider {
    /**
     * Devuelve las configuraciones de depuración que ofrece la extensión.
     *
     * @param _carpeta Carpeta del espacio de trabajo (no se usa).
     * @param _token Token de cancelación (no se usa).
     * @returns Lista con la configuración de lanzamiento por defecto.
     */
    provideDebugConfigurations(_carpeta: WorkspaceFolder | undefined, _token?: CancellationToken): DebugConfiguration[] {
        return [
            {
                type: 'forja',
                request: 'launch',
                name: 'Forja: Debug archivo activo',
                program: '${file}',
            },
        ];
    }

    /**
     * Completa la configuración de depuración antes de lanzarla.
     *
     * Si no se indicó `program`, se toma el archivo del editor activo siempre
     * que sea un archivo Forja.
     *
     * @param _carpeta Carpeta del espacio de trabajo (no se usa).
     * @param configuracionDepuracion Configuración tal como la escribió el usuario.
     * @param _token Token de cancelación (no se usa).
     * @returns La configuración completada.
     */
    resolveDebugConfiguration(
        _carpeta: WorkspaceFolder | undefined,
        configuracionDepuracion: DebugConfiguration,
        _token?: CancellationToken
    ): DebugConfiguration | undefined {
        // Sin programa explícito, se usa el archivo del editor activo.
        if (!configuracionDepuracion.program) {
            const editor = window.activeTextEditor;
            if (editor && editor.document.languageId === 'forja') {
                configuracionDepuracion.program = editor.document.fileName;
            }
        }
        return configuracionDepuracion;
    }
}

/**
 * Localiza el binario del adaptador de depuración.
 *
 * Busca primero en `target/debug`, luego en `target/release` y por último en
 * el `PATH` del sistema.
 *
 * @param contexto Contexto de la extensión usado para resolver rutas relativas.
 * @returns Ruta absoluta del binario, o `undefined` si no se encontró.
 */
function buscarBinarioDap(contexto: ExtensionContext): string | undefined {
    const esWindows = process.platform === 'win32';
    const nombreEjecutable = `forja-dap${esWindows ? '.exe' : ''}`;

    const rutaDebug = contexto.asAbsolutePath(path.join('..', 'target', 'debug', nombreEjecutable));
    if (fs.existsSync(rutaDebug)) {
        return rutaDebug;
    }

    const rutaRelease = contexto.asAbsolutePath(path.join('..', 'target', 'release', nombreEjecutable));
    if (fs.existsSync(rutaRelease)) {
        return rutaRelease;
    }

    return buscarEnRuta('forja-dap');
}

// ======================================================================
// Proveedor de tareas
// ======================================================================

/** Definición de una tarea de Forja tal como la consume VS Code. */
interface DefinicionTareaForja extends TaskDefinition {
    /** Tarea interna que se ejecutará. */
    task: NombreTarea;
    /** Argumentos adicionales de la CLI, si los hay. */
    args?: string;
}

/**
 * Proveedor de tareas que expone los comandos habituales de la CLI como tareas
 * de VS Code, para poder lanzarlas desde el menú o encadenarlas.
 */
class ProveedorTareasForja implements TaskProvider {
    /**
     * Genera las tareas disponibles a partir del archivo Forja visible.
     *
     * @returns Lista de tareas; vacía si no hay ningún editor Forja visible.
     */
    async provideTasks(): Promise<Task[]> {
        const tareas: Task[] = [];
        const editores = window.visibleTextEditors.filter(editor => editor.document.languageId === 'forja');
        if (editores.length === 0) {
            return [];
        }

        const rutaArchivo = editores[0].document.fileName;

        // Catálogo de tareas que se publican al usuario.
        const configuracionesTarea: { nombre: NombreTarea; etiqueta: string; grupo: TaskGroup; argumentos: string }[] = [
            { nombre: 'run', etiqueta: 'Run (FastVM)', grupo: TaskGroup.Build, argumentos: 'run --fast' },
            { nombre: 'run-jit', etiqueta: 'Run (JIT)', grupo: TaskGroup.Build, argumentos: 'run --jit' },
            { nombre: 'test', etiqueta: 'Run tests', grupo: TaskGroup.Test, argumentos: 'test' },
            { nombre: 'build', etiqueta: 'Build bytecode', grupo: TaskGroup.Build, argumentos: 'build' },
            { nombre: 'build-asm', etiqueta: 'Build to ASM', grupo: TaskGroup.Build, argumentos: 'build --asm' },
            { nombre: 'build-wasm', etiqueta: 'Build to WASM', grupo: TaskGroup.Build, argumentos: 'build --target wasm32-unknown-unknown' },
        ];

        for (const configuracion of configuracionesTarea) {
            const definicion: DefinicionTareaForja = {
                type: 'forja',
                task: configuracion.nombre,
            };

            const tarea = new Task(
                definicion,
                TaskScope.Workspace,
                `Forja: ${configuracion.etiqueta}`,
                'forja',
                new CustomExecution(
                    async (): Promise<Pseudoterminal> => {
                        return new PseudoterminalForja(`forja ${configuracion.argumentos} "${rutaArchivo}"`);
                    }
                ),
                '$(zap)',
            );
            tarea.group = configuracion.grupo;

            tareas.push(tarea);
        }

        return tareas;
    }

    /**
     * Devuelve la tarea ya resuelta (no requiere trabajo adicional).
     *
     * @param tarea Tarea tal como llegó desde VS Code.
     * @returns La misma tarea.
     */
    resolveTask(tarea: Task): Task | undefined {
        return tarea;
    }
}

/**
 * Pseudoterminal que ejecuta una orden de la CLI y muestra su salida en el
 * panel de tareas de VS Code.
 */
class PseudoterminalForja implements Pseudoterminal {
    /** Emisor de la salida de texto que se pinta en el panel. */
    private emisorEscritura = new EventEmitter<string>();
    /** Emisor que señala el cierre del proceso. */
    private emisorCierre = new EventEmitter<void>();

    /** Evento al que se suscribe VS Code para escribir la salida. */
    readonly onDidWrite = this.emisorEscritura.event;
    /** Evento al que se suscribe VS Code para cerrar el panel. */
    readonly onDidClose = this.emisorCierre.event;

    /**
     * @param comando Línea de órdenes completa que se ejecutará al abrirse el panel.
     */
    constructor(private comando: string) { }

    /**
     * Arranca el proceso y conecta su salida al panel.
     *
     * @param _dimensionesIniciales Dimensiones del panel (no se usan).
     * @returns Nada.
     */
    open(_dimensionesIniciales: any): void {
        this.emisorEscritura.fire(`Ejecutando: ${this.comando}\r\n\r\n`);
        const hijo = exec(this.comando, {
            cwd: workspace.workspaceFolders?.[0]?.uri?.fsPath,
            windowsHide: true,
        });

        hijo.stdout?.on('data', (datos: string) => {
            this.emisorEscritura.fire(datos);
        });

        hijo.stderr?.on('data', (datos: string) => {
            this.emisorEscritura.fire(datos);
        });

        hijo.on('close', (codigo: number) => {
            this.emisorEscritura.fire(`\r\nProceso terminado con código: ${codigo}\r\n`);
            this.emisorCierre.fire();
        });

        hijo.on('error', (error: Error) => {
            this.emisorEscritura.fire(`\r\nError: ${error.message}\r\n`);
            this.emisorCierre.fire();
        });
    }

    /**
     * Cierra el panel. No requiere limpieza: el proceso hijo ya se gestiona solo.
     *
     * @returns Nada.
     */
    close(): void {
        // Sin operación: el cierre del proceso dispara `emisorCierre`.
    }
}

// ======================================================================
// Utilidades del sistema
// ======================================================================

/**
 * Busca un ejecutable en los directorios del `PATH`.
 *
 * En Windows añade la extensión `.exe` al nombre buscado.
 *
 * @param nombreBinario Nombre del ejecutable sin extensión.
 * @returns Ruta absoluta del primer ejecutable encontrado, o `undefined`.
 */
function buscarEnRuta(nombreBinario: string): string | undefined {
    const esWindows = process.platform === 'win32';
    const nombreEjecutable = esWindows ? `${nombreBinario}.exe` : nombreBinario;
    const directoriosRuta = (process.env.PATH || '').split(path.delimiter);

    for (const directorio of directoriosRuta) {
        try {
            const rutaCompleta = path.join(directorio, nombreEjecutable);
            if (fs.existsSync(rutaCompleta)) {
                return rutaCompleta;
            }
        } catch {
            continue;
        }
    }
    return undefined;
}
