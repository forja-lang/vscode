// Forja Diagram Viewer — Webview v0.4.0
// Arbol AST interactivo, diagrama de flujo, mapa de dependencias

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

type DiagramType = 'flow' | 'ast' | 'deps' | 'classes';

export class ForjaDiagramProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'forja.diagram';
    private _view?: vscode.WebviewView;
    private _currentDiagram: DiagramType = 'flow';

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
                case 'generate': {
                    this._currentDiagram = msg.diagramType || 'flow';
                    const editor = vscode.window.activeTextEditor;
                    const source = editor?.document.getText() || '';
                    await this._generateDiagram(source);
                    break;
                }
                case 'exportSvg': {
                    // Export SVG content
                    const svgContent = msg.svg;
                    const uri = await vscode.window.showSaveDialog({
                        filters: { 'SVG Image': ['svg'] },
                        defaultUri: vscode.Uri.file('diagram.svg'),
                    });
                    if (uri) {
                        fs.writeFileSync(uri.fsPath, svgContent, 'utf-8');
                        vscode.window.showInformationMessage(`Diagrama guardado: ${uri.fsPath}`);
                    }
                    break;
                }
            }
        });
    }

    private async _generateDiagram(source: string) {
        if (!source.trim()) {
            this._view?.webview.postMessage({
                type: 'diagramOutput',
                html: '<span style="color:#f44747;">No hay codigo fuente. Abre un archivo .fa o escribe codigo.</span>',
            });
            return;
        }

        const cmd = vscode.workspace.getConfiguration('forja').get<string>('diagram.command', 'forja');
        const diagramFlag = this._currentDiagram === 'ast' ? '--ast'
            : this._currentDiagram === 'deps' ? '--deps'
            : this._currentDiagram === 'classes' ? '--classes'
            : '';

        this._view?.webview.postMessage({
            type: 'diagramOutput',
            html: `<span style="color:#569cd6;">Generando diagrama ${this._currentDiagram}...</span><br>`,
        });

        // Save source to temp file and run forja diagram
        const tmpFile = path.join(__dirname, '..', '..', '.diagram_temp.fa');
        try {
            fs.writeFileSync(tmpFile, source, 'utf-8');

            const child = spawn(cmd, ['diagram', diagramFlag, tmpFile].filter(Boolean), {
                windowsHide: true,
                shell: true,
            });

            let out = '';
            let err = '';

            child.stdout?.on('data', (data: Buffer) => {
                out += data.toString();
            });

            child.stderr?.on('data', (data: Buffer) => {
                err += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0 && out) {
                    this._view?.webview.postMessage({
                        type: 'diagramOutput',
                        html: out,
                    });
                } else {
                    this._view?.webview.postMessage({
                        type: 'diagramOutput',
                        html: `<span style="color:#f44747;">Error: ${this._escapeHtml(err || 'No se pudo generar el diagrama')}</span>`,
                    });
                }

                // Cleanup temp file
                try { fs.unlinkSync(tmpFile); } catch {}
            });
        } catch (e: any) {
            this._view?.webview.postMessage({
                type: 'diagramOutput',
                html: `<span style="color:#f44747;">Error: ${this._escapeHtml(e.message)}</span>`,
            });
        }
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
    #toolbar { display: flex; gap: 6px; padding: 8px; background: #2d2d2d; border-bottom: 1px solid #3c3c3c; align-items: center; flex-shrink: 0; flex-wrap: wrap; }
    #toolbar select { background: #3c3c3c; color: #ccc; border: 1px solid #555; padding: 4px 8px; font-size: 12px; border-radius: 3px; }
    #toolbar button { background: #0e639c; color: white; border: none; padding: 4px 12px; cursor: pointer; font-size: 12px; border-radius: 3px; }
    #toolbar button:hover { background: #1177bb; }
    #toolbar button.secundario { background: #3c3c3c; }
    #toolbar button.secundario:hover { background: #505050; }
    #toolbar .titulo { flex: 1; font-size: 12px; color: #888; }
    #panels { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    #canvas { flex: 1; overflow: auto; padding: 12px; }
    #canvas svg { width: 100%; height: auto; min-height: 200px; }
    #canvas .placeholder { color: #888; text-align: center; padding: 40px 20px; font-size: 14px; }
    #empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #888; padding: 20px; }
    #empty-state .icon { font-size: 48px; margin-bottom: 12px; }
    #empty-state .hint { font-size: 12px; margin-top: 8px; color: #555; }
    #divider { height: 5px; background: #2d2d2d; cursor: row-resize; flex-shrink: 0; border-top: 1px solid #3c3c3c; border-bottom: 1px solid #3c3c3c; display: none; }
    #divider:hover { background: #3c3c3c; }
    #info { padding: 8px 12px; font-size: 11px; color: #888; flex-shrink: 0; border-top: 1px solid #3c3c3c; }
    .mermaid { font-family: 'Consolas', 'Courier New', monospace; white-space: pre-wrap; }
</style>
</head>
<body>
<div id="toolbar">
    <span class="titulo">Diagramas</span>
    <select id="diagramType">
        <option value="flow">Diagrama de flujo</option>
        <option value="ast">Arbol AST</option>
        <option value="deps">Dependencias</option>
        <option value="classes">Clases</option>
    </select>
    <button id="btnGenerate">generar</button>
    <button id="btnExport" class="secundario">exportar SVG</button>
</div>
<div id="panels">
    <div id="canvas">
        <div id="empty-state">
            <div class="icon"></div>
            <div>Genera diagramas de tu codigo Forja</div>
            <div class="hint">Abre un archivo .fa y haz clic en "generar"</div>
        </div>
    </div>
    <div id="divider"></div>
    <div id="info">Selecciona el tipo de diagrama y haz clic en generar</div>
</div>
<script>
    (function() {
        const vscode = acquireVsCodeApi();
        const canvas = document.getElementById('canvas');
        const diagramType = document.getElementById('diagramType');
        const btnGenerate = document.getElementById('btnGenerate');
        const btnExport = document.getElementById('btnExport');
        const divider = document.getElementById('divider');
        const info = document.getElementById('info');
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
            const infoHeight = info.offsetHeight;
            const newCanvasHeight = e.clientY - panelRect.top;
            const newInfoHeight = panelRect.bottom - e.clientY - dividerHeight;
            if (newCanvasHeight > 100 && newInfoHeight > 30) {
                canvas.style.flex = 'none';
                canvas.style.height = newCanvasHeight + 'px';
            }
        });
        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });

        btnGenerate.addEventListener('click', () => {
            vscode.postMessage({
                type: 'generate',
                diagramType: diagramType.value,
            });
        });

        btnExport.addEventListener('click', () => {
            const svg = canvas.querySelector('svg');
            if (svg) {
                vscode.postMessage({ type: 'exportSvg', svg: svg.outerHTML });
            } else {
                vscode.postMessage({ type: 'showMessage', text: 'No hay diagrama para exportar' });
            }
        });

        window.addEventListener('message', (e) => {
            const msg = e.data;
            if (msg.type === 'diagramOutput') {
                canvas.innerHTML = msg.html;
            }
            if (msg.type === 'setSource') {
            }
        });
    })();
</script>
</body>
</html>`;
    }
}
