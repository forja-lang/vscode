// Forja Diagram Viewer — Webview v7
// Renderiza diagramas de flujo nativos en formato Mermaid estándar con Zoom y Pan

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

export class ForjaDiagramProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'forja.diagram';
    private _view?: vscode.WebviewView;
    private _isReady = false;
    private _lastCode?: string;

    constructor(private readonly _extensionUri: vscode.Uri) { }

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

        const mediaPath = vscode.Uri.joinPath(this._extensionUri, 'media');
        const mermaidUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'mermaid.min.js'));

        webviewView.webview.html = this._getHtml(mermaidUri);

        // Escuchar mensajes desde la webview (por ejemplo, para exportar o cuando esté lista)
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'ready': {
                    this._isReady = true;
                    if (this._lastCode) {
                        this._view?.webview.postMessage({
                            type: 'renderMermaid',
                            code: this._lastCode
                        });
                    } else {
                        this.updateActiveDiagram();
                    }
                    break;
                }
                case 'exportSvg': {
                    const svgContent = msg.svg;
                    const uri = await vscode.window.showSaveDialog({
                        filters: { 'SVG Image': ['svg'] },
                        defaultUri: vscode.Uri.file('diagrama.svg'),
                    });
                    if (uri) {
                        fs.writeFileSync(uri.fsPath, svgContent, 'utf-8');
                        vscode.window.showInformationMessage(`Diagrama guardado en: ${uri.fsPath}`);
                    }
                    break;
                }
            }
        });
    }

    public async updateActiveDiagram() {
        if (!this._view) return;

        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'forja') {
            this._lastCode = undefined;
            this._view.webview.postMessage({
                type: 'emptyState',
                message: 'Abre un archivo Forja (.fa) para ver su diagrama'
            });
            return;
        }

        const source = editor.document.getText();
        if (!source.trim()) {
            this._lastCode = undefined;
            this._view.webview.postMessage({
                type: 'emptyState',
                message: 'El archivo Forja actual está vacío'
            });
            return;
        }

        await this._generateDiagram(source);
    }

    private async _generateDiagram(source: string) {
        if (!this._view) return;

        const cmd = vscode.workspace.getConfiguration('forja').get<string>('diagram.command', 'forja');

        // Rutas temporales para la generación del diagrama
        const extensionDir = path.join(this._extensionUri.fsPath);
        const tmpFile = path.join(extensionDir, '.diagram_temp.fa');
        const mmdFile = path.join(extensionDir, '.diagram_temp.mmd');

        try {
            fs.writeFileSync(tmpFile, source, 'utf-8');

            const child = spawn(cmd, ['diagram', tmpFile, '-o', mmdFile], {
                windowsHide: true,
                shell: true,
            });

            let err = '';
            child.stderr?.on('data', (data: Buffer) => {
                err += data.toString();
            });

            child.on('close', (code) => {
                // Eliminar archivo .fa temporal
                try { fs.unlinkSync(tmpFile); } catch { }

                if (code === 0 && fs.existsSync(mmdFile)) {
                    let mmdContent = fs.readFileSync(mmdFile, 'utf-8');

                    // Eliminar el archivo MMD generado temporalmente
                    try { fs.unlinkSync(mmdFile); } catch { }

                    this._lastCode = mmdContent;

                    // Enviar la sintaxis Mermaid a la webview si ya está lista
                    if (this._isReady) {
                        this._view!.webview.postMessage({
                            type: 'renderMermaid',
                            code: mmdContent
                        });
                    }
                } else {
                    this._view!.webview.postMessage({
                        type: 'error',
                        message: `Error al generar diagrama: ${err || 'Proceso falló'}`
                    });
                }
            });
        } catch (e: any) {
            this._view.webview.postMessage({
                type: 'error',
                message: `Error: ${e.message}`
            });
        }
    }

    private _getHtml(mermaidUri: vscode.Uri): string {
        return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<!-- Carga de Mermaid.js para renderizado nativo en la Webview -->
<script src="${mermaidUri}"></script>
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
    const container = document.getElementById('container');
    const wrapper = document.getElementById('zoom-wrapper');
    const btnReset = document.getElementById('btnReset');
    const btnExport = document.getElementById('btnExport');

    // Inicializar Mermaid
    mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose'
    });

    let scale = 1.0;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const updateTransform = () => {
        wrapper.style.transform = \`translate(\${translateX}px, \${translateY}px) scale(\${scale})\`;
    };

    // Pan (arrastrar)
    container.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Solo click izquierdo
        isDragging = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        updateTransform();
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    window.addEventListener('mouseleave', () => {
        isDragging = false;
    });

    window.addEventListener('blur', () => {
        isDragging = false;
    });

    // Zoom (rueda mouse)
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = 1.08;
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const contentX = (mouseX - translateX) / scale;
        const contentY = (mouseY - translateY) / scale;

        if (e.deltaY < 0) {
            scale = Math.min(scale * zoomFactor, 1000.0);
        } else {
            scale = Math.max(scale / zoomFactor, 0.01);
        }

        translateX = mouseX - contentX * scale;
        translateY = mouseY - contentY * scale;

        updateTransform();
    }, { passive: false });

    // Resetear
    btnReset.addEventListener('click', () => {
        scale = 1.0;
        translateX = 0;
        translateY = 0;
        updateTransform();
    });

    container.addEventListener('dblclick', () => {
        scale = 1.0;
        translateX = 0;
        translateY = 0;
        updateTransform();
    });

    // Exportar
    btnExport.addEventListener('click', () => {
        const svgElement = wrapper.querySelector('svg');
        if (svgElement) {
            let svgContent = svgElement.outerHTML;
            // Reemplazar <br> no cerrados por <br /> para cumplir con la especificación estricta de XML/SVG
            svgContent = svgContent.replace(/<br(?!\s*\/)>/gi, '<br />');
            vscode.postMessage({
                type: 'exportSvg',
                svg: svgContent
            });
        }
    });

    // Escuchar mensajes desde la extensión
    window.addEventListener('message', async (event) => {
        const msg = event.data;
        if (msg.type === 'renderMermaid') {
            try {
                // Renderizar código Mermaid usando un ID único cada vez
                const id = 'mermaid-' + Date.now();
                const { svg } = await mermaid.render(id, msg.code);
                wrapper.innerHTML = svg;
                
                // Centrar automáticamente
                scale = 1.0;
                translateX = 0;
                translateY = 0;
                updateTransform();
            } catch (err) {
                wrapper.innerHTML = \`<div class="state-container">
                    <div class="state-icon" style="color: #f85149;">❌</div>
                    <div style="color: #f85149;">Error al renderizar</div>
                    <div style="font-size: 0.85em; max-width: 300px; margin-top: 8px;">\${err.message || err}</div>
                </div>\`;
            }
        } else if (msg.type === 'emptyState') {
            wrapper.innerHTML = \`<div class="state-container">
                <div class="state-icon">📊</div>
                <div>\${msg.message}</div>
            </div>\`;
        } else if (msg.type === 'error') {
            wrapper.innerHTML = \`<div class="state-container">
                <div class="state-icon" style="color: #f85149;">⚠️</div>
                <div style="color: #f85149;">\${msg.message}</div>
            </div>\`;
        }
    });

    // Indicar a la extensión que la webview está lista
    vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
