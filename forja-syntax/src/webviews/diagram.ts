/**
 * Visor de diagramas de flujo de Forja.
 *
 * Toma el código Forja del editor activo, invoca `forja diagrama` para obtener
 * el grafo en formato Mermaid y lo renderiza dentro de un panel webview con
 * zoom, desplazamiento (pan) y exportación a SVG.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';

/**
 * Proveedor del panel webview que muestra el diagrama del archivo activo.
 *
 * Mantiene una única vista, recuerda el último diagrama generado para poder
 * repintarlo cuando la webview termina de cargar y evita regenerar el grafo si
 * el código no cambió.
 */
export class ProveedorDiagramaForja implements vscode.WebviewViewProvider {
    /** Identificador de vista que debe coincidir con el declarado en `package.json`. */
    public static readonly tipoVista = 'forja.diagram';

    /** Vista webview una vez resuelta por VS Code. */
    private _vista?: vscode.WebviewView;

    /** Indica si el documento de la webview terminó de cargar y puede recibir mensajes. */
    private _estaLista = false;

    /** Último código Mermaid generado, pendiente de pintar. */
    private _ultimoCodigo?: string;

    /**
     * @param _uriExtension URI raíz de la extensión, usada para resolver los recursos de `media/`.
     */
    constructor(private readonly _uriExtension: vscode.Uri) { }

    /**
     * Inicializa la webview cuando VS Code resuelve la vista.
     *
     * Configura los recursos locales permitidos, inyecta el HTML con Mermaid y
     * atiende los mensajes que llegan desde el panel (listo, exportar SVG).
     *
     * @param vistaWebview Vista que aporta VS Code.
     * @param _contexto Contexto de resolución de la vista (no se usa).
     * @param _token Token de cancelación (no se usa).
     * @returns Nada.
     */
    resolveWebviewView(
        vistaWebview: vscode.WebviewView,
        _contexto: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._vista = vistaWebview;

        vistaWebview.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._uriExtension],
        };

        const rutaMedia = vscode.Uri.joinPath(this._uriExtension, 'media');
        const uriMermaid = vistaWebview.webview.asWebviewUri(vscode.Uri.joinPath(rutaMedia, 'mermaid.min.js'));

        vistaWebview.webview.html = this._obtenerHtml(uriMermaid);

        // Mensajes que envía la webview: aviso de carga y petición de exportación.
        vistaWebview.webview.onDidReceiveMessage(async (mensaje) => {
            switch (mensaje.type) {
                case 'ready': {
                    this._estaLista = true;
                    if (this._ultimoCodigo) {
                        this._vista?.webview.postMessage({
                            type: 'renderMermaid',
                            code: this._ultimoCodigo
                        });
                    } else {
                        this.actualizarDiagramaActivo();
                    }
                    break;
                }
                case 'exportSvg': {
                    const contenidoSvg = mensaje.svg;
                    const uri = await vscode.window.showSaveDialog({
                        filters: { 'SVG Image': ['svg'] },
                        defaultUri: vscode.Uri.file('diagrama.svg'),
                    });
                    if (uri) {
                        fs.writeFileSync(uri.fsPath, contenidoSvg, 'utf-8');
                        vscode.window.showInformationMessage(`Diagrama guardado en: ${uri.fsPath}`);
                    }
                    break;
                }
            }
        });
    }

    /**
     * Regenera el diagrama a partir del editor activo.
     *
     * Si no hay editor o el archivo no es Forja, o si el archivo está vacío,
     * muestra un estado vacío en el panel en lugar de un diagrama.
     *
     * @returns Promesa que se resuelve cuando se envió la orden de generación.
     */
    public async actualizarDiagramaActivo() {
        if (!this._vista) return;

        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'forja') {
            this._ultimoCodigo = undefined;
            this._vista.webview.postMessage({
                type: 'emptyState',
                message: 'Abre un archivo Forja (.fa) para ver su diagrama'
            });
            return;
        }

        const fuente = editor.document.getText();
        if (!fuente.trim()) {
            this._ultimoCodigo = undefined;
            this._vista.webview.postMessage({
                type: 'emptyState',
                message: 'El archivo Forja actual está vacío'
            });
            return;
        }

        await this._generarDiagrama(fuente);
    }

    /**
     * Invoca `forja diagrama` sobre el código fuente y envía el Mermaid al panel.
     *
     * Escribe el código en un archivo temporal `.fa`, ejecuta la CLI (que deja
     * el `.mmd` junto al fuente, porque no admite flags) y borra ambos archivos
     * al terminar. Si la CLI falla, envía el mensaje de error a la webview.
     *
     * @param fuente Código Forja del que se genera el diagrama.
     * @returns Promesa que se resuelve cuando el proceso hijo terminó.
     */
    private async _generarDiagrama(fuente: string) {
        if (!this._vista) return;

        const comando = vscode.workspace.getConfiguration('forja').get<string>('command', 'forja') || 'forja';

        // Archivos temporales donde se vuelca el código y el Mermaid resultante.
        const archivoTemporal = path.join(os.tmpdir(), `forja-diagrama-${process.pid}.fa`);
        const archivoMmd = path.join(os.tmpdir(), `forja-diagrama-${process.pid}.mmd`);

        try {
            fs.writeFileSync(archivoTemporal, fuente, 'utf-8');

            const hijo = spawn(comando, ['diagrama', archivoTemporal], {
                // La CLI lee `forja.yaml` del directorio de trabajo: usar el
                // workspace (o el temporal) para no ensuciar el cwd del host.
                cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.tmpdir(),
                windowsHide: true,
                shell: false,
            });

            let error = '';
            hijo.stderr?.on('data', (datos: Buffer) => {
                error += datos.toString();
            });

            hijo.on('close', (codigo) => {
                // Eliminar el archivo .fa temporal.
                try { fs.unlinkSync(archivoTemporal); } catch { }

                if (codigo === 0 && fs.existsSync(archivoMmd)) {
                    let contenidoMmd = fs.readFileSync(archivoMmd, 'utf-8');

                    // Eliminar el archivo MMD generado temporalmente.
                    try { fs.unlinkSync(archivoMmd); } catch { }

                    this._ultimoCodigo = contenidoMmd;

                    // Enviar la sintaxis Mermaid a la webview si ya está lista.
                    if (this._estaLista) {
                        this._vista!.webview.postMessage({
                            type: 'renderMermaid',
                            code: contenidoMmd
                        });
                    }
                } else {
                    this._vista!.webview.postMessage({
                        type: 'error',
                        message: `Error al generar diagrama: ${error || 'Proceso falló'}`
                    });
                }
            });
        } catch (excepcion: any) {
            this._vista.webview.postMessage({
                type: 'error',
                message: `Error: ${excepcion.message}`
            });
        }
    }

    /**
     * Construye el documento HTML del panel.
     *
     * Incluye la hoja de estilos, la botonera, el contenedor del diagrama y el
     * script de la webview que implementa el renderizado con Mermaid, el zoom
     * con la rueda, el arrastre para desplazar y la exportación a SVG.
     *
     * @param uriMermaid URI resuelta de `media/mermaid.min.js`.
     * @returns Documento HTML completo.
     */
    private _obtenerHtml(uriMermaid: vscode.Uri): string {
        return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<!-- Carga de Mermaid.js para el renderizado nativo dentro de la webview -->
<script src="${uriMermaid}"></script>
<style>
    body {
        margin: 0;
        padding: 10px;
        height: 100vh;
        overflow: hidden;
        background: #0d1117;
        color: #c9d1d9;
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        flex-direction: column;
    }
    
    .hd {
        margin-bottom: 12px;
        padding: 8px 12px;
        background: #161b22;
        border-radius: 6px;
        border: 1px solid #30363d;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }
    
    .hd h1 {
        font-size: 1.05em;
        margin: 0;
        margin-right: auto;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    
    button {
        background: #21262d;
        color: #c9d1d9;
        border: 1px solid #30363d;
        padding: 4px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: .8em;
        white-space: nowrap;
        transition: background 0.2s, border-color 0.2s;
    }
    
    button:hover {
        background: #30363d;
        border-color: #8b949e;
    }
    
    #container {
        flex: 1;
        position: relative;
        overflow: hidden;
        border-radius: 8px;
        border: 1px solid #30363d;
        background: #161b22;
        cursor: grab;
    }
    
    #container:active {
        cursor: grabbing;
    }
    
    #zoom-wrapper {
        position: absolute;
        transform-origin: 0 0;
        width: max-content;
        height: max-content;
        min-width: 100%;
        min-height: 100%;
        padding: 30px;
        box-sizing: border-box;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    #zoom-wrapper svg {
        max-width: 100%;
        height: auto;
    }

    .state-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        text-align: center;
        color: #8b949e;
        padding: 20px;
    }
    
    .state-icon {
        font-size: 40px;
        margin-bottom: 12px;
    }
</style>
</head>
<body>
<div class="hd">
    <h1>Diagrama Mermaid</h1>
    <button id="btnReset">Reiniciar</button>
    <button id="btnExport">SVG</button>
</div>
<div id="container">
    <div id="zoom-wrapper">
        <div class="state-container">
            <div>Cargando visor de diagramas...</div>
        </div>
    </div>
</div>

<script>
    const vscode = acquireVsCodeApi();
    const contenedor = document.getElementById('container');
    const envoltorio = document.getElementById('zoom-wrapper');
    const botonReiniciar = document.getElementById('btnReset');
    const botonExportar = document.getElementById('btnExport');

    // Inicializar Mermaid en modo oscuro y sin carga automática.
    mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose'
    });

    let escala = 1.0;
    let desplazamientoX = 0;
    let desplazamientoY = 0;
    let arrastrando = false;
    let inicioX = 0;
    let inicioY = 0;

    // Aplica la traslación y la escala actuales al envoltorio del diagrama.
    const actualizarTransformacion = () => {
        envoltorio.style.transform = \`translate(\${desplazamientoX}px, \${desplazamientoY}px) scale(\${escala})\`;
    };

    // ── Desplazamiento (arrastrar) ──
    contenedor.addEventListener('mousedown', (evento) => {
        if (evento.button !== 0) return; // Solo click izquierdo.
        arrastrando = true;
        inicioX = evento.clientX - desplazamientoX;
        inicioY = evento.clientY - desplazamientoY;
        evento.preventDefault();
    });

    window.addEventListener('mousemove', (evento) => {
        if (!arrastrando) return;
        desplazamientoX = evento.clientX - inicioX;
        desplazamientoY = evento.clientY - inicioY;
        actualizarTransformacion();
    });

    window.addEventListener('mouseup', () => {
        arrastrando = false;
    });

    window.addEventListener('mouseleave', () => {
        arrastrando = false;
    });

    window.addEventListener('blur', () => {
        arrastrando = false;
    });

    // ── Zoom con la rueda del ratón, anclado al puntero ──
    contenedor.addEventListener('wheel', (evento) => {
        evento.preventDefault();
        const factorZoom = 1.08;
        const rectangulo = contenedor.getBoundingClientRect();
        const ratonX = evento.clientX - rectangulo.left;
        const ratonY = evento.clientY - rectangulo.top;

        const contenidoX = (ratonX - desplazamientoX) / escala;
        const contenidoY = (ratonY - desplazamientoY) / escala;

        if (evento.deltaY < 0) {
            escala = Math.min(escala * factorZoom, 1000.0);
        } else {
            escala = Math.max(escala / factorZoom, 0.01);
        }

        desplazamientoX = ratonX - contenidoX * escala;
        desplazamientoY = ratonY - contenidoY * escala;

        actualizarTransformacion();
    }, { passive: false });

    // ── Reiniciar la vista a escala 1 y sin desplazamiento ──
    botonReiniciar.addEventListener('click', () => {
        escala = 1.0;
        desplazamientoX = 0;
        desplazamientoY = 0;
        actualizarTransformacion();
    });

    contenedor.addEventListener('dblclick', () => {
        escala = 1.0;
        desplazamientoX = 0;
        desplazamientoY = 0;
        actualizarTransformacion();
    });

    // ── Exportar el SVG actual ──
    botonExportar.addEventListener('click', () => {
        const elementoSvg = envoltorio.querySelector('svg');
        if (elementoSvg) {
            let contenidoSvg = elementoSvg.outerHTML;
            // Reemplazar <br> sin cerrar por <br /> para cumplir con la especificación XML/SVG.
            contenidoSvg = contenidoSvg.replace(/<br(?!\s*\/)>/gi, '<br />');
            vscode.postMessage({
                type: 'exportSvg',
                svg: contenidoSvg
            });
        }
    });

    // ── Mensajes que llegan desde la extensión ──
    window.addEventListener('message', async (evento) => {
        const mensaje = evento.data;
        if (mensaje.type === 'renderMermaid') {
            try {
                // Se usa un ID único para que Mermaid no reutilice el SVG anterior.
                const id = 'mermaid-' + Date.now();
                const { svg } = await mermaid.render(id, mensaje.code);
                envoltorio.innerHTML = svg;
                
                // Centrar automáticamente el diagrama recién renderizado.
                escala = 1.0;
                desplazamientoX = 0;
                desplazamientoY = 0;
                actualizarTransformacion();
            } catch (error) {
                envoltorio.innerHTML = \`<div class="state-container">
                    <div class="state-icon" style="color: #f85149;">❌</div>
                    <div style="color: #f85149;">Error al renderizar</div>
                    <div style="font-size: 0.85em; max-width: 300px; margin-top: 8px;">\${error.message || error}</div>
                </div>\`;
            }
        } else if (mensaje.type === 'emptyState') {
            envoltorio.innerHTML = \`<div class="state-container">
                <div class="state-icon">📊</div>
                <div>\${mensaje.message}</div>
            </div>\`;
        } else if (mensaje.type === 'error') {
            envoltorio.innerHTML = \`<div class="state-container">
                <div class="state-icon" style="color: #f85149;">⚠️</div>
                <div style="color: #f85149;">\${mensaje.message}</div>
            </div>\`;
        }
    });

    // Avisar a la extensión de que la webview ya está lista para recibir datos.
    vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
