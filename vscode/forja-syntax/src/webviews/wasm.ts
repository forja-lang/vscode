// Forja WASM Playground — Webview v0.4.0
// Compila Forja a WASM y ejecuta en sandbox

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

export class ForjaWasmPlaygroundProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'forja.wasmPlayground';
    private _view?: vscode.WebviewView;

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

        webviewView.webview.html = this._getHtml();

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'compile': {
                    await this._compileAndRun(msg.code);
                    break;
                }
                case 'clear': {
                    this._view?.webview.postMessage({ type: 'clearOutput' });
                    break;
                }
            }
        });
    }

    private async _compileAndRun(code: string) {
        const cmd = vscode.workspace.getConfiguration('forja').get<string>('wasm.command', 'forja');

        this._postOutput(`\n<span style="color:#569cd6;">Compilando a WASM...</span><br>`);

        const child = spawn(cmd, ['build', '--target', 'wasm32-unknown-unknown', '--eval', code], {
            windowsHide: true,
            shell: true,
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        child.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        child.on('close', (codeExit) => {
            if (codeExit !== 0) {
                this._postOutput(`<span style="color:#f44747;">Error de compilación:</span><br>`);
                if (stderr) {
                    this._postOutput(`<span style="color:#f44747;">${this._escapeHtml(stderr)}</span><br>`);
                }
                return;
            }

            this._postOutput(`<span style="color:#6a9955;">Compilación WASM exitosa</span><br>`);

            // If compiled successfully, try to run with wasm target
            this._postOutput(`<span style="color:#569cd6;">Ejecutando en entorno WASM...</span><br>`);

            const runChild = spawn(cmd, ['run', '--target', 'wasm32-unknown-unknown', '--eval', code], {
                windowsHide: true,
                shell: true,
            });

            let runOut = '';
            let runErr = '';

            runChild.stdout?.on('data', (data: Buffer) => {
                runOut += data.toString();
            });

            runChild.stderr?.on('data', (data: Buffer) => {
                runErr += data.toString();
            });

            runChild.on('close', () => {
                if (runOut) {
                    this._postOutput(`<pre style="color:#d4d4d4; margin:4px 0;">${this._escapeHtml(runOut)}</pre>`);
                }
                if (runErr) {
                    this._postOutput(`<span style="color:#f44747;">${this._escapeHtml(runErr)}</span><br>`);
                }
                this._postOutput(`<span style="color:#6a9955;">Listo</span><br>`);
            });
        });
    }

    private _postOutput(html: string) {
        this._view?.webview.postMessage({ type: 'output', html });
    }

    private _escapeHtml(text: string): string {
        return text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
    }

    private _getHtml(): string {
        return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; background: #1e1e1e; color: #d4d4d4; height: 100vh; display: flex; flex-direction: column; }
    #toolbar { display: flex; gap: 6px; padding: 8px; background: #2d2d2d; border-bottom: 1px solid #3c3c3c; align-items: center; flex-shrink: 0; }
    #toolbar button { background: #0e639c; color: white; border: none; padding: 6px 14px; cursor: pointer; font-size: 12px; border-radius: 3px; }
    #toolbar button:hover { background: #1177bb; }
    #toolbar button.secundario { background: #3c3c3c; }
    #toolbar button.secundario:hover { background: #505050; }
    #toolbar .titulo { flex: 1; font-size: 12px; color: #888; }
    #toolbar .etiqueta { background: #4ec9b0; color: #1e1e1e; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
    #panels { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    #editor { flex: 1; min-height: 80px; }
    #editor textarea { width: 100%; height: 100%; background: #1e1e1e; color: #d4d4d4; border: none; padding: 10px; font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; resize: none; outline: none; tab-size: 4; }
    #divider { height: 5px; background: #2d2d2d; cursor: row-resize; flex-shrink: 0; border-top: 1px solid #3c3c3c; border-bottom: 1px solid #3c3c3c; }
    #divider:hover { background: #3c3c3c; }
    #output { height: 150px; min-height: 60px; background: #1e1e1e; border-top: 2px solid #3c3c3c; padding: 10px; overflow-y: auto; font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; line-height: 1.5; }
    #info { background: #2d2d2d; border-top: 1px solid #3c3c3c; padding: 8px 12px; font-size: 11px; color: #888; flex-shrink: 0; }
    #info a { color: #569cd6; text-decoration: none; }
</style>
</head>
<body>
<div id="toolbar">
    <span class="titulo">Laboratorio WASM</span>
    <span class="etiqueta">BETA</span>
    <span class="spacer"></span>
    <button id="btnCompile">Ejecutar</button>
    <button id="btnClear" class="secundario">Limpiar</button>
</div>
<div id="panels">
    <div id="editor">
        <textarea id="code" spellcheck="false" placeholder="// Escribe código Forja aqui...
// Ejemplo:
escribir("Hola desde WASM!")

var nums = [1, 2, 3, 4, 5]
var suma = 0
para n en nums {
    suma = suma + n
}
escribir("Suma: ", suma)">// Ejemplo WASM
escribir("Hola desde WASM!")

var nums = [1, 2, 3, 4, 5]
var suma = 0
para n en nums {
    suma = suma + n
}
escribir("Suma: ", suma)</textarea>
    </div>
    <div id="divider"></div>
    <div id="output"></div>
</div>
<div id="info">
    Requiere destino wasm32: <a href="#" onclick="vscode.postMessage({type:'installWasm'})">rustup target add wasm32-unknown-unknown</a>
</div>
<script>
    (function() {
        const vscode = acquireVsCodeApi();
        const code = document.getElementById('code');
        const output = document.getElementById('output');
        const btnCompile = document.getElementById('btnCompile');
        const btnClear = document.getElementById('btnClear');
        const divider = document.getElementById('divider');
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
            const outputHeight = output.offsetHeight;
            const newOutputHeight = Math.max(60, panelRect.bottom - e.clientY);
            const newEditorHeight = e.clientY - panelRect.top - dividerHeight;
            if (newEditorHeight > 40 && newOutputHeight > 40) {
                output.style.height = newOutputHeight + 'px';
                output.style.minHeight = newOutputHeight + 'px';
            }
        });
        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });

        btnCompile.addEventListener('click', () => {
            vscode.postMessage({ type: 'compile', code: code.value });
        });

        btnClear.addEventListener('click', () => {
            vscode.postMessage({ type: 'clear' });
        });

        code.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = code.selectionStart;
                const end = code.selectionEnd;
                code.value = code.value.substring(0, start) + '    ' + code.value.substring(end);
                code.selectionStart = code.selectionEnd = start + 4;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                btnCompile.click();
            }
        });

        window.addEventListener('message', (e) => {
            const msg = e.data;
            if (msg.type === 'output') {
                output.innerHTML += msg.html;
                output.scrollTop = output.scrollHeight;
            }
            if (msg.type === 'clearOutput') {
                output.innerHTML = '';
            }
        });
    })();
</script>
</body>
</html>`;
    }
}
