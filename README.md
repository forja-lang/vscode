# 🔥 Forja para Visual Studio Code

[![Version](https://img.shields.io/badge/version-0.9.7-007ACC?logo=visualstudiocode)](https://github.com/forja-lang/forja)
[![Marketplace](https://img.shields.io/badge/vscode-marketplace-007ACC?logo=visualstudiocode)](https://github.com/forja-lang/forja)
[![Licencia](https://img.shields.io/badge/license-MIT-green)](LICENSE.md)

Extensión oficial del lenguaje **Forja (fa)** para Visual Studio Code — un lenguaje de programación moderno, expresivo y multi-paradigma con sintaxis en español.

---

## ✨ Características

- **Resaltado de sintaxis** con gramática TextMate personalizada (todos los keywords, tipos, strings, operadores, etc.)
- **LSP (Language Server Protocol)** — análisis semántico, diagnóstico en tiempo real y autocompletado vía `forja-lsp`
- **Depurador integrado** — configuración de lanzamiento para depurar archivos `.fa` con breakpoints, inspección de variables y paso a paso
- **Comandos alineados con la CLI** — la CLI `forja` no usa flags: motor y destino se leen de `forja.yaml`
- **Snippets** para keywords, estructuras de control y tipos
- **Task provider** para ejecutar, testear, medir, compilar, compilar a ASM y formatear
- **10 keybindings** para acceso rápido a las operaciones más frecuentes
- **Sidebar** dedicada con vista de diagramas Mermaid generada por `forja diagrama`
- **Recarga en caliente (Hot Reload)** automática al guardar archivos `.fa`
- **Compilación a ejecutable, ASM y Android** según `destino` / `arquitectura` de `forja.yaml`
- **Paleta de colores coherente** con el CLI `forja colorear` y la documentación web
- Auto-cierre de brackets `{}`, `()`, `[]`, comillas `""` e indentación automática

---

## ⚡ Comandos Disponibles

Todos los comandos invocan la CLI con **argumentos posicionales** (la CLI no acepta flags) y corren en la raíz del workspace para que `forja.yaml` sea el que gobierna la ejecución.

| Comando | Título | Orden de la CLI |
|---------|--------|-----------------|
| `forja.run` | Forja: ejecutar | `forja ejecutar <archivo>` |
| `forja.runNative` | Forja: ejecutar en modo nativo/GUI | deja `destino: nativo` y ejecuta |
| `forja.runDebug` | Forja: ejecutar en modo depuración | `forja-dap` (DAP) |
| `forja.runRepl` | Forja: abrir consola interactiva (REPL) | `forja repl` |
| `forja.build` | Forja: compilar a ejecutable | `forja compilar <archivo>` |
| `forja.buildASM` | Forja: compilar a ASM | `forja asm <archivo>` |
| `forja.buildAndroid` | Forja: compilar para Android | `scripts/build-android.sh` |
| `forja.buildAndroid.arm64` | Forja: compilar para Android ARM64 | `scripts/build-android.sh aarch64-linux-android` |
| `forja.buildAndroid.x86_64` | Forja: compilar para Android x86_64 | `scripts/build-android.sh x86_64-linux-android` |
| `forja.buildAndroid.all` | Forja: compilar para Android (todos) | `scripts/build-android.sh` |
| `forja.checkAndroidNDK` | Forja: verificar NDK Android | `scripts/toolchain-android.sh check` |
| `forja.deployAndroid` | Forja: desplegar en dispositivo Android | `adb push` |
| `forja.test` | Forja: ejecutar pruebas | `forja test <archivo>` |
| `forja.bench` | Forja: medir rendimiento | `forja medir <archivo>` |
| `forja.fmt` | Forja: formatear archivo | `forja formatear <archivo>` |
| `forja.doc` | Forja: generar documentación HTML | `forja documentar <archivo>` |
| `forja.diagram` | Forja: generar diagrama | `forja diagrama <archivo>` |
| `forja.transpile` | Forja: transpilar a Rust | `forja transpilar <archivo>` |
| `forja.hotReload` | Forja: recarga en caliente | reinicia `forja ejecutar` |
| `forja.hotRestart` | Forja: reinicio en caliente | mata los procesos vivos |
| `forja.toggleHotReload` | Forja: activar o desactivar recarga en caliente | — |
| `forja.newProject` | Forja: crear nuevo proyecto | `forja nuevo <ruta>` |
| `forja.selectVM` | Forja: seleccionar motor (forja.yaml) | escribe `motor:` en `forja.yaml` |
| `forja.selectTarget` | Forja: seleccionar destino (forja.yaml) | escribe `destino:` en `forja.yaml` |
| `forja.openConfig` | Forja: abrir forja.yaml | abre/crea `forja.yaml` |
| `forja.showOutput` | Forja: mostrar salida | — |
| `forja.installToolchain` | Forja: instalar o verificar el entorno | `cargo build --features lsp,dap` |
| `forja.openTutorial` | Forja: abrir tutorial interactivo | `forja aprender` |
| `forja.openDiagram` | Forja: abrir visor de diagramas | — |
| `forja.toggleSidebar` | Forja: alternar panel lateral | — |
| `forja.openStdlib` | Forja: abrir biblioteca estándar | abre `stdlib/` del repo |
| `forja.openFile` | Forja: abrir archivo | — |
| `forja.revealLine` | Forja: ir a línea | — |

---

## ⚙️ Configuraciones

El comportamiento de la CLI **no se configura con flags ni con ajustes de VS Code**: sale de `forja.yaml` (se crea solo en el directorio donde corre `forja`). La extensión lee `motor` y `destino` de ese archivo para la barra de estado y los escribe cuando usás los selectores.

| Nombre | Tipo | Valor por defecto | Descripción |
|--------|------|-------------------|-------------|
| `forja.command` | `string` | `"forja"` | Comando o ruta absoluta al ejecutable de la CLI Forja |
| `forja.lsp.path` | `string` | `""` | Ruta al binario `forja-lsp`. Vacío = PATH o `target/debug|release` |
| `forja.lsp.enabled` | `boolean` | `true` | Habilitar/deshabilitar el servidor LSP |
| `forja.terminal.preserveFocus` | `boolean` | `false` | Mantener el foco en el editor al ejecutar comandos |
| `forja.terminal.clearBeforeRun` | `boolean` | `false` | Limpiar la terminal antes de ejecutar |
| `forja.hotReload.enabled` | `boolean` | `true` | Recarga en caliente automática al guardar archivos `.fa` |

### `forja.yaml`

```yaml
motor: rapido              # rapido (ForjaFast) | jit | todas (solo `medir`)
destino: maquina           # maquina | ensamblador | nativo
arquitectura: ''           # '' | x86_64-windows | x86_64-linux | arm64 | riscv64
recarga: falso             # hot reload (destino: nativo)
iteraciones: 100           # iteraciones de `medir`
```

El resto de las claves (`estricto`, `contratos`, `pila`, `matematica_rapida`, `perfil`, `permitir_red`, `permitir_puertos`, `max_archivo_mb`, `consola`, `verificar_formato`, `lint_estricto`, `nivel`, `json`, `color`, `puerto_registry`) está documentado en el README principal del repo.

---

## ⌨️ Keybindings

| Tecla | Comando | Cuándo |
|-------|---------|--------|
| `Ctrl+Alt+R` | `forja.run` | `editorLangId == forja` |
| `Ctrl+Alt+G` | `forja.runNative` | `editorLangId == forja` |
| `Ctrl+Alt+D` | `forja.runDebug` | `editorLangId == forja` |
| `Ctrl+Alt+L` | `forja.fmt` | `editorLangId == forja` |
| `Ctrl+Alt+T` | `forja.test` | `editorLangId == forja` |
| `Ctrl+Alt+P` | `forja.runRepl` | `editorLangId == forja` |
| `Ctrl+Alt+H` | `forja.hotReload` | `editorLangId == forja` |
| `Ctrl+Shift+R` | `forja.hotRestart` | `editorLangId == forja` |
| `Ctrl+Alt+E` | `forja.openTutorial` | `editorLangId == forja` |
| `Ctrl+Alt+C` | `forja.openConfig` | `editorLangId == forja` |

---

## 🎨 Paleta de colores

| Token | Color | CSS/ANSI | Elementos |
|-------|-------|----------|-----------|
| `keyword` | `#f59e0b` 🔶 | `var(--fuego-light)` | `variable`, `si`, `funcion`, `clase`, `coincidir`, etc. |
| `function` | `#10.9.3` 🟢 | `var(--verde)` | `escribir()`, `leer()` |
| `type` | `#06b6d4` 🔷 | `var(--cian)` | `Entero`, `Decimal`, `Texto`, `Booleano` |
| `string` | `#fbbf24` ⭐ | gold | Texto entre comillas dobles |
| `comment` | `#5b6a84` 🌫️ | `var(--text-muted)` | Líneas con `//` |
| `operator` | `#ec4899` 🩷 | `var(--rosa)` | `+`, `-`, `*`, `/`, `==`, `&&`, `\|\|` |
| `number` | `#818cf8` 💜 | `var(--acero-light)` | Literales numéricos |
| `boolean` | `#f59e0b` 🔶 | `var(--fuego-light)` | `verdadero`, `falso` |

La paleta de colores de esta extensión es idéntica a la usada en el comando CLI `forja highlight`, la documentación web y el playground WASM.

---

## 🔧 Requisitos

- **Rust toolchain** (cargo, rustc) — necesario para compilar el núcleo de Forja
- **Forja** instalado en el sistema (`forja`, `forja-lsp` disponibles en PATH)
- VS Code `^1.60.0` o superior

---

## 📦 Instalación

### Desde VS Code Marketplace

1. Abrir VS Code
2. `Ctrl+Shift+P` → "Extensions: Install Extensions"
3. Buscar "Forja (fa)"
4. Hacer clic en "Instalar"

### Desde archivo VSIX

1. Descargar el `.vsix` desde [Releases](https://github.com/forja-lang/forja/releases)
2. `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
3. Seleccionar el archivo `.vsix` descargado

### Desde terminal

```bash
code --install-extension forja-syntax-0.9.7.vsix
```

---

## 🚀 Uso rápido

1. Abrí un archivo `.fa` (la primera vez, `forja` crea `forja.yaml` con los valores por defecto)
2. Usá `Ctrl+Shift+P` y buscá "Forja: ejecutar", o `Ctrl+Alt+R`
3. Para cambiar el motor (ForjaFast / JIT) o el destino (máquina / ASM / nativo-GUI), hacé clic en los indicadores de la barra de estado o usá `Forja: seleccionar motor/destino (forja.yaml)`
4. `Ctrl+Alt+C` abre `forja.yaml` para editar el resto de las opciones

---

## 📁 Estructura del repositorio

| Ruta | Propósito |
|------|-----------|
| `vscode/forja-syntax/` | Código fuente de la extensión |
| `vscode/forja-syntax/package.json` | Manifiesto de la extensión |
| `vscode/forja-syntax/language-configuration.json` | Configuración de comentarios, brackets, auto-cierre, indentación |
| `vscode/forja-syntax/syntaxes/forja.tmLanguage.json` | Gramática TextMate |
| `vscode/forja-syntax/src/` | Código TypeScript de la extensión |
| `vscode/forja-syntax/snippets/forja.json` | Snippets del lenguaje |
| `.github/workflows/package.yml` | CI: empaquetado automático del VSIX |

---

## 🤝 Contribuir

```bash
git clone https://github.com/forja-lang/forja.git
cd vscode/forja-syntax
npm install
```

Para desarrollo:

1. Abrí la carpeta `vscode/forja-syntax/` en VS Code
2. Presioná `F5` para iniciar una ventana de Extension Development Host
3. Editá los archivos en `syntaxes/`, `src/` o `language-configuration.json`
4. Recargá con `Ctrl+Shift+P` → "Developer: Reload Window"
5. Compilá con `npm run compile`
6. Opcional: regenerá el VSIX con `npx vsce package`

---

## 📝 Notas de versión

**Versión actual: 0.9.7** — Comandos alineados con la CLI 0.9.7: sin flags (`--fast`, `--jit`, `--aot`, `--gui`, `--asm`, `--target`), configuración exclusivamente en `forja.yaml`, y verbos reales (`ejecutar`, `compilar`, `asm`, `medir`, `formatear`, `documentar`, `diagrama`, `transpilar`, `test`, `repl`, `aprender`, `nuevo`).

---

## 📄 Licencia

MIT — Ver archivo [LICENSE.md](LICENSE.md) para más detalles.
