// Forja REPL Interactivo — Webview v0.4.0
// Consola interactiva para evaluar expresiones Forja en tiempo real

import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';

export class ForjaReplProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'forja.repl';
    private _view?: vscode.WebviewView;
    private _replProcess?: ChildProcess;
    private _history: string[] = [];
    private _historyIndex = -1;

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
                case 'eval': {
                    await this._evalCode(msg.code);
                    break;
                }
                case 'clear': {
                    this._view?.webview.postMessage({ type: 'clearOutput' });
                    break;
                }
                case 'kill': {
                    this._killProcess();
                    break;
                }
                case 'historyUp': {
                    if (this._history.length === 0) break;
                    this._historyIndex = Math.max(0, this._historyIndex - 1);
                    this._view?.webview.postMessage({ type: 'historyEntry', entry: this._history[this._historyIndex] });
                    break;
                }
                case 'historyDown': {
                    if (this._history.length === 0) break;
                    this._historyIndex = Math.min(this._history.length, this._historyIndex + 1);
                    const entry = this._historyIndex < this._history.length ? this._history[this._historyIndex] : '';
                    this._view?.webview.postMessage({ type: 'historyEntry', entry });
                    break;
                }
            }
        });
    }

    private async _evalCode(code: string) {
        if (this._replProcess) {
            this._replProcess.stdin?.write(code + '\n');
            return;
        }

        const vmMode = this._view?.webview.options || {};
        const cmd = 'forja';
        const args = ['repl'];

        this._postOutput(`<span class="prompt">> ${code}</span><br>`);
        this._history.push(code);
        this._historyIndex = this._history.length;

        this._replProcess = spawn(cmd, args, {
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath,
            windowsHide: true,
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this._replProcess.stdin?.write(code + '\n');
        this._replProcess.stdin?.end();

        let output = '';
        this._replProcess.stdout?.on('data', (data: Buffer) => {
            output += data.toString();
            this._postOutput(ansiToHtml(data.toString()));
        });

        this._replProcess.stderr?.on('data', (data: Buffer) => {
            this._postOutput(`<span class="error">${data.toString()}</span>`);
        });

        this._replProcess.on('close', (code) => {
            this._postOutput(`<br><span class="prompt">Proceso terminado (codigo: ${code})</span><br>`);
            this._replProcess = undefined;
        });

        this._replProcess.on('error', (err) => {
            this._postOutput(`<span class="error">Error: ${err.message}</span><br>`);
            this._replProcess = undefined;
        });
    }

    private _killProcess() {
        if (this._replProcess) {
            this._replProcess.kill();
            this._replProcess = undefined;
            this._postOutput('<span class="prompt">Proceso detenido</span><br>');
        }
    }

    private _postOutput(text: string) {
        this._view?.webview.postMessage({ type: 'output', html: text });
    }

    private _getHtml(): string {
        return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; background: #1e1e1e; color: #d4d4d4; height: 100vh; display: flex; flex-direction: column; }
    #toolbar { display: flex; gap: 4px; padding: 6px; background: #2d2d2d; border-bottom: 1px solid #3c3c3c; flex-shrink: 0; align-items: center; }
    #toolbar button { background: #3c3c3c; color: #ccc; border: 1px solid #555; padding: 3px 10px; cursor: pointer; font-size: 12px; border-radius: 3px; }
    #toolbar button:hover { background: #505050; }
    #toolbar select { background: #3c3c3c; color: #ccc; border: 1px solid #555; padding: 3px 6px; font-size: 12px; border-radius: 3px; margin-left: auto; }
    #toolbar .titulo { font-size: 12px; color: #888; }
    #panels { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    #output { flex: 1; overflow-y: auto; padding: 8px; white-space: pre-wrap; word-wrap: break-word; line-height: 1.5; }
    #output .prompt { color: #569cd6; }
    #output .error { color: #f44747; }
    #output .success { color: #6a9955; }
    #divider { height: 5px; background: #2d2d2d; cursor: row-resize; flex-shrink: 0; border-top: 1px solid #3c3c3c; border-bottom: 1px solid #3c3c3c; }
    #divider:hover { background: #3c3c3c; }
    #input-row { display: flex; padding: 6px; background: #2d2d2d; border-top: 1px solid #3c3c3c; flex-shrink: 0; gap: 4px; }
    #input-row input { flex: 1; background: #1e1e1e; color: #d4d4d4; border: 1px solid #3c3c3c; padding: 6px 8px; font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; outline: none; }
    #input-row input:focus { border-color: #569cd6; }
    #input-row button { background: #0e639c; color: white; border: none; padding: 6px 14px; cursor: pointer; font-size: 12px; border-radius: 3px; }
    #input-row button:hover { background: #1177bb; }
</style>
</head>
<body>
<div id="toolbar">
    <span class="titulo">VM</span>
    <button id="btnClear" title="Limpiar salida">Limpiar</button>
    <button id="btnKill" title="Interrumpir proceso actual">Interrumpir</button>
    <select id="vmSelect">
        <option value="fastvm">fastVM</option>
        <option value="vm">VM</option>
        <option value="jit">JIT</option>
    </select>
</div>
<div id="panels">
    <div id="output"><span class="prompt">Forja VM — Escribe codigo y presiona Enter</span></div>
    <div id="divider"></div>
    <div id="input-row">
        <input id="input" type="text" placeholder="Escribe código Forja..." autofocus>
        <button id="btnSend">Ejecutar</button>
    </div>
</div>
<script>
    (function() {
        const vscode = acquireVsCodeApi();
        const output = document.getElementById('output');
        const input = document.getElementById('input');
        const btnSend = document.getElementById('btnSend');
        const btnClear = document.getElementById('btnClear');
        const btnKill = document.getElementById('btnKill');
        const vmSelect = document.getElementById('vmSelect');
        const divider = document.getElementById('divider');
        const panels = document.getElementById('panels');
        const inputRow = document.getElementById('input-row');

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
            const inputHeight = inputRow.offsetHeight;
            const newOutputHeight = Math.max(50, e.clientY - panelRect.top - dividerHeight - inputHeight);
            const totalHeight = panelRect.height;
            output.style.flex = 'none';
            output.style.height = newOutputHeight + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });

        function sendEval() {
            const code = input.value.trim();
            if (!code) return;
            vscode.postMessage({ type: 'eval', code });
            input.value = '';
        }

        btnSend.addEventListener('click', sendEval);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendEval();
            if (e.key === 'ArrowUp') { e.preventDefault(); vscode.postMessage({ type: 'historyUp' }); }
            if (e.key === 'ArrowDown') { e.preventDefault(); vscode.postMessage({ type: 'historyDown' }); }
        });
        btnClear.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
        btnKill.addEventListener('click', () => vscode.postMessage({ type: 'kill' }));

        window.addEventListener('message', (e) => {
            const msg = e.data;
            switch (msg.type) {
                case 'output':
                    output.innerHTML += msg.html;
                    output.scrollTop = output.scrollHeight;
                    break;
                case 'clearOutput':
                    output.innerHTML = '';
                    break;
                case 'historyEntry':
                    input.value = msg.entry;
                    break;
            }
        });
    })();
</script>
</body>
</html>`;
    }
}

function ansiToHtml(text: string): string {
    return text
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/\x1b\[31m/g, '<span class="error">')
        .replace(/\x1b\[32m/g, '<span class="success">')
        .replace(/\x1b\[33m/g, '<span style="color:#ce9178;">')
        .replace(/\x1b\[34m/g, '<span style="color:#569cd6;">')
        .replace(/\x1b\[0m/g, '</span>')
        .replace(/\n/g, '<br>');
}
