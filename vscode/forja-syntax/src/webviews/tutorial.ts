// Forja Tutorial Interactivo — Webview v0.4.0
// Sistema de lecciones interactivas para aprender el lenguaje Forja

import * as vscode from 'vscode';
import { spawn } from 'child_process';

interface Leccion {
    titulo: string;
    descripcion: string;
    concepto: string;
    codigoInicial: string;
}

const LECCIONES: Leccion[] = [
    {
        titulo: 'Hola Mundo',
        descripcion: 'Tu primer programa en Forja',
        concepto: 'Para escribir texto en pantalla se usa la funcion <b>escribir</b>. Todo programa comienza con esta instruccion basica.',
        codigoInicial: 'escribir("Hola Mundo")\n',
    },
    {
        titulo: 'Variables',
        descripcion: 'Almacenar valores en variables',
        concepto: 'Las variables se declaran con <b>var</b>. Pueden reasignarse. Si no cambian, usa <b>let</b> para constantes.',
        codigoInicial: 'var nombre = "Forja"\nvar edad = 5\n\nescribir("Lenguaje: ", nombre)\nescribir("Edad: ", edad)\n',
    },
    {
        titulo: 'Tipos de Datos',
        descripcion: 'Enteros, decimales, texto, booleanos',
        concepto: 'Forja tiene tipos como <b>Entero</b>, <b>Decimal</b>, <b>Texto</b> y <b>Booleano</b>. Se infieren automaticamente.',
        codigoInicial: 'var entero = 42\nvar decimal = 3.14\nvar texto = "Hola"\nvar verdad = cierto\n\nescribir(entero, " ", decimal, " ", texto, " ", verdad)\n',
    },
    {
        titulo: 'Condicionales',
        descripcion: 'Tomar decisiones con si/sino',
        concepto: 'La estructura <b>si</b> permite ejecutar codigo condicionalmente. Soporta <b>sino</b> y <b>sino si</b>.',
        codigoInicial: 'var x = 10\n\nsi x > 5 {\n    escribir("x es mayor que 5")\n} sino {\n    escribir("x es menor o igual a 5")\n}\n',
    },
    {
        titulo: 'Bucles',
        descripcion: 'Repetir codigo con mientras y para',
        concepto: '<b>mientras</b> repite mientras una condicion sea cierta. <b>para</b> itera sobre colecciones o rangos.',
        codigoInicial: '// Bucle mientras\nvar i = 0\nmientras i < 5 {\n    escribir("i = ", i)\n    i = i + 1\n}\n\nescribir("---")\n\n// Bucle para\npara n en [1, 2, 3] {\n    escribir("n = ", n)\n}\n',
    },
    {
        titulo: 'Funciones',
        descripcion: 'Definir y llamar funciones',
        concepto: 'Las funciones se definen con <b>fn</b>. Pueden tener parametros y valor de retorno con <b>-></b>.',
        codigoInicial: 'fn saludar(nombre) {\n    escribir("Hola ", nombre)\n}\n\nfn sumar(a, b) -> Entero {\n    retornar a + b\n}\n\nsaludar("Mundo")\nvar resultado = sumar(3, 4)\nescribir("Suma: ", resultado)\n',
    },
    {
        titulo: 'Arreglos',
        descripcion: 'Colecciones de valores',
        concepto: 'Los arreglos se crean con <b>[]</b>. Pueden contener cualquier tipo y se accede por indice.',
        codigoInicial: 'var numeros = [10, 20, 30, 40, 50]\nescribir("Primero: ", numeros[0])\nescribir("Ultimo: ", numeros[4])\n\nnumeros[2] = 99\nescribir("Modificado: ", numeros[2])\n\nescribir("Total elementos: ", numeros.longitud)\n',
    },
    {
        titulo: 'Cadenas de Texto',
        descripcion: 'Operaciones con texto',
        concepto: 'Las cadenas soportan interpolacion, concatenacion y varios metodos como <b>longitud</b>, <b>mayusculas</b>, etc.',
        codigoInicial: 'var saludo = "Hola"\nvar nombre = "Forja"\n\nvar mensaje = saludo + " " + nombre + "!"\nescribir(mensaje)\nescribir("Longitud: ", mensaje.longitud)\nescribir("Mayusculas: ", mensaje.mayusculas())\n',
    },
];

export class ForjaTutorialProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'forja.tutorial';
    private _view?: vscode.WebviewView;
    private _currentLeccion = 0;
    private _progress = 0;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        this._render();

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'next': {
                    if (this._currentLeccion < LECCIONES.length - 1) {
                        this._currentLeccion++;
                        this._render();
                    }
                    break;
                }
                case 'prev': {
                    if (this._currentLeccion > 0) {
                        this._currentLeccion--;
                        this._render();
                    }
                    break;
                }
                case 'select': {
                    if (msg.index >= 0 && msg.index < LECCIONES.length) {
                        this._currentLeccion = msg.index;
                        this._render();
                    }
                    break;
                }
                case 'run': {
                    await this._runCode(msg.code);
                    break;
                }
                case 'complete': {
                    if (this._progress <= this._currentLeccion) {
                        this._progress = this._currentLeccion + 1;
                        this._render();
                    }
                    break;
                }
            }
        });
    }

    private async _runCode(code: string) {
        this._view?.webview.postMessage({ type: 'output', html: '<span class="prompt">Ejecutando...</span><br>' });

        const child = spawn('forja', ['repl'], {
            windowsHide: true,
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        child.stdin?.write(code + '\n');
        child.stdin?.end();

        let out = '';
        child.stdout?.on('data', (data: Buffer) => {
            out += data.toString();
        });

        let err = '';
        child.stderr?.on('data', (data: Buffer) => {
            err += data.toString();
        });

        child.on('close', (code) => {
            if (out) {
                this._view?.webview.postMessage({ type: 'output', html: `<pre>${out}</pre>` });
            }
            if (err) {
                this._view?.webview.postMessage({ type: 'output', html: `<span class="error">${err}</span>` });
            }
            this._view?.webview.postMessage({ type: 'output', html: `<span class="prompt">Codigo terminado (codigo: ${code})</span><br>` });
        });
    }

    private _render() {
        if (!this._view) return;

        const leccion = LECCIONES[this._currentLeccion];
        const total = LECCIONES.length;
        const pct = Math.round((this._progress / total) * 100);

        let listaLecciones = '';
        for (let i = 0; i < total; i++) {
            const l = LECCIONES[i];
            const active = i === this._currentLeccion ? ' class="active"' : '';
            listaLecciones += `<li${active} onclick="selectLeccion(${i})">${l.titulo}</li>`;
        }

        this._view.webview.html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; background: #1e1e1e; color: #d4d4d4; height: 100vh; display: flex; flex-direction: column; }
    #panels { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    #sidebar { width: 130px; min-width: 100px; background: #252526; border-right: 1px solid #3c3c3c; overflow-y: auto; flex-shrink: 0; }
    #sidebar h3 { padding: 8px 10px; font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }
    #sidebar ul { list-style: none; }
    #sidebar li { padding: 4px 10px; cursor: pointer; font-size: 11px; border-left: 3px solid transparent; }
    #sidebar li:hover { background: #2a2d2e; }
    #sidebar li.active { background: #37373d; border-left-color: #569cd6; color: #fff; }
    #content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    #header { padding: 16px 20px 8px; border-bottom: 1px solid #3c3c3c; }
    #header h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
    #header .desc { color: #888; font-size: 13px; }
    #concepto { padding: 10px 20px; background: #2d2d2d; border-bottom: 1px solid #3c3c3c; font-size: 13px; line-height: 1.5; }
    #editor { flex: 1; position: relative; min-height: 80px; }
    #editor textarea { width: 100%; height: 100%; background: #1e1e1e; color: #d4d4d4; border: none; padding: 12px; font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; resize: none; outline: none; tab-size: 4; }
    #divider { height: 5px; background: #2d2d2d; cursor: row-resize; flex-shrink: 0; border-top: 1px solid #3c3c3c; border-bottom: 1px solid #3c3c3c; }
    #divider:hover { background: #3c3c3c; }
    #output { max-height: 200px; background: #1e1e1e; border-top: 1px solid #3c3c3c; padding: 10px 20px; overflow-y: auto; font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; white-space: pre-wrap; display: none; }
    #output .prompt { color: #569cd6; }
    #output .error { color: #f44747; }
    #toolbar { display: flex; gap: 6px; padding: 8px 20px; background: #2d2d2d; border-top: 1px solid #3c3c3c; align-items: center; flex-shrink: 0; }
    #toolbar button { background: #0e639c; color: white; border: none; padding: 6px 16px; cursor: pointer; font-size: 12px; border-radius: 3px; }
    #toolbar button:hover { background: #1177bb; }
    #toolbar button.secondary { background: #3c3c3c; }
    #toolbar button.secondary:hover { background: #505050; }
    #toolbar button:disabled { opacity: 0.4; cursor: default; }
    #toolbar .spacer { flex: 1; }
    #toolbar .counter { color: #888; font-size: 12px; }
    .progress-bar { height: 3px; background: #3c3c3c; flex-shrink: 0; }
    .progress-bar .fill { height: 100%; background: #4ec9b0; transition: width 0.3s; }
</style>
</head>
<body>
<div class="progress-bar"><div class="fill" style="width:${pct}%"></div></div>
<div id="panels">
    <div style="display:flex; flex:1; overflow:hidden;">
        <div id="sidebar">
            <h3>Lecciones</h3>
            <ul>${listaLecciones}</ul>
        </div>
        <div id="content">
            <div id="header">
                <h1>${leccion.titulo}</h1>
                <div class="desc">${leccion.descripcion}</div>
            </div>
            <div id="concepto">${leccion.concepto}</div>
            <div id="editor">
                <textarea id="codeEditor">${leccion.codigoInicial.replace(/</g, '<').replace(/>/g, '>')}</textarea>
            </div>
        </div>
    </div>
    <div id="divider" style="display:none;"></div>
    <div id="output"></div>
    <div id="toolbar">
        <button class="secondary" id="btnPrev" ${this._currentLeccion === 0 ? 'disabled' : ''}>Anterior</button>
        <button id="btnRun">Ejecutar</button>
        <button id="btnComplete" class="secondary" ${this._progress > this._currentLeccion ? 'disabled' : ''}>Completar</button>
        <span class="spacer"></span>
        <span class="counter">${this._currentLeccion + 1}/${total}</span>
        <button class="secondary" id="btnNext" ${this._currentLeccion >= total - 1 ? 'disabled' : ''}>Siguiente</button>
    </div>
</div>
<script>
    (function() {
        const vscode = acquireVsCodeApi();
        const editor = document.getElementById('codeEditor');
        const output = document.getElementById('output');
        const btnRun = document.getElementById('btnRun');
        const btnPrev = document.getElementById('btnPrev');
        const btnNext = document.getElementById('btnNext');
        const btnComplete = document.getElementById('btnComplete');
        const divider = document.getElementById('divider');
        const content = document.getElementById('content');
        const panels = document.getElementById('panels');

        // Divider arrastrable
        let dragging = false;
        divider.addEventListener('mousedown', (e) => {
            dragging = true;
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const panelRect = panels.getBoundingClientRect();
            const dividerHeight = divider.offsetHeight;
            const toolbarHeight = document.getElementById('toolbar').offsetHeight;
            const newOutputHeight = Math.max(50, panelRect.bottom - e.clientY - toolbarHeight - dividerHeight);
            output.style.maxHeight = newOutputHeight + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });

        btnRun.addEventListener('click', () => {
            output.style.display = 'block';
            divider.style.display = 'block';
            vscode.postMessage({ type: 'run', code: editor.value });
        });
        btnPrev.addEventListener('click', () => vscode.postMessage({ type: 'prev' }));
        btnNext.addEventListener('click', () => vscode.postMessage({ type: 'next' }));
        btnComplete.addEventListener('click', () => {
            vscode.postMessage({ type: 'complete' });
            btnComplete.disabled = true;
            btnComplete.textContent = 'Completado';
        });
        document.querySelectorAll('#sidebar li').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.getAttribute('onclick')?.match(/\\d+/)?.[0] || '0');
                vscode.postMessage({ type: 'select', index: idx });
            });
        });

        window.addEventListener('message', (e) => {
            const msg = e.data;
            if (msg.type === 'output') {
                output.style.display = 'block';
                divider.style.display = 'block';
                output.innerHTML += msg.html;
                output.scrollTop = output.scrollHeight;
            }
        });

        // Tab support in textarea
        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = editor.selectionStart;
                const end = editor.selectionEnd;
                editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
                editor.selectionStart = editor.selectionEnd = start + 4;
            }
        });
    })();
</script>
</body>
</html>`;
    }
}
