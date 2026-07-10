# Forja — Extensión de VS Code

[![Marketplace](https://img.shields.io/badge/vscode-marketplace-007ACC?logo=visualstudiocode)](https://github.com/forja-lang/vscode)
[![CI](https://github.com/forja-lang/vscode/actions/workflows/package.yml/badge.svg)](https://github.com/forja-lang/vscode/actions/workflows/package.yml)

Extensión oficial para el lenguaje de programación **Forja** (archivos `.fa`) con soporte de sintaxis, LSP, compilación, depuración y toolchain.

## Características

- ✅ Resaltado de sintaxis completo para todas las keywords de Forja
- ✅ Paleta de colores coherente con el CLI (`forja highlight`) y la documentación web
- ✅ Auto-cierre de brackets `{}`, `()`, `[]`
- ✅ Auto-cierre de comillas `""`
- ✅ Indentación automática después de `{`
- ✅ Comentarios de línea con `//`

## Paleta de colores

| Token | Color | CSS/ANSI | Elementos |
|-------|-------|----------|-----------|
| `keyword` | `#f59e0b` 🔶 | `var(--fuego-light)` | `variable`, `si`, `funcion`, `clase`, `coincidir`, etc. |
| `function` | `#10b981` 🟢 | `var(--verde)` | `escribir()`, `leer()` |
| `type` | `#06b6d4` 🔷 | `var(--cian)` | `Entero`, `Decimal`, `Texto`, `Booleano` |
| `string` | `#fbbf24` ⭐ | gold | Texto entre comillas dobles |
| `comment` | `#5b6a84` 🌫️ | `var(--text-muted)` | Líneas con `//` |
| `operator` | `#ec4899` 🩷 | `var(--rosa)` | `+`, `-`, `*`, `/`, `==`, `&&`, `\|\|` |
| `number` | `#818cf8` 💜 | `var(--acero-light)` | Literales numéricos |
| `boolean` | `#f59e0b` 🔶 | `var(--fuego-light)` | `verdadero`, `falso` |

## Instalación

### Desde VSIX (recomendado)

1. Descargar el `.vsix` desde [Releases](https://github.com/forja-lang/vscode/releases)
2. En VS Code: `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
3. Seleccionar el archivo `.vsix` descargado
4. Abrir un archivo `.fa` — la sintaxis se colorea automáticamente

### Desde terminal

```bash
code --install-extension forja-syntax-0.3.0.vsix
```

## Estructura del repositorio

| Ruta | Propósito |
|------|-----------|
| `forja-syntax/` | Código fuente de la extensión |
| `forja-syntax/package.json` | Manifiesto de la extensión |
| `forja-syntax/language-configuration.json` | Configuración de comentarios, brackets, auto-cierre, indentación |
| `forja-syntax/syntaxes/forja.tmLanguage.json` | Gramática TextMate |
| `forja-syntax/src/` | Código TypeScript de la extensión |
| `.github/workflows/package.yml` | CI: empaquetado automático del VSIX |

## Keywords soportadas

```
variable, var, constante, const, mut, si, sino, mientras, para, repetir,
funcion, retornar, clase, constructor, nuevo, este, prestado, importar,
coincidir, caso, tipo, verdadero, falso, nulo, arreglo, mapa
```

## Desarrollo

```bash
git clone https://github.com/forja-lang/vscode.git
cd vscode/forja-syntax
npm install
```

Para modificar la extensión:

1. Editá los archivos en `forja-syntax/syntaxes/` o `forja-syntax/language-configuration.json`
2. Recargá VS Code: `Ctrl+Shift+P` → "Developer: Reload Window"
3. Compilá con `npm run compile`
4. Opcional: regenerá el VSIX con `npx vsce package`

## Coherencia de paleta

La paleta de colores de esta extensión es idéntica a la usada en:

- El comando CLI `forja highlight`
- La documentación web del proyecto
- El playground interactivo WASM

Esto asegura una experiencia visual consistente en todos los entornos donde se usa Forja.

## Repositorios relacionados

- [forja-lang/forja](https://github.com/forja-lang/forja) — Núcleo del lenguaje
- [forja-lang/docs](https://github.com/forja-lang/docs) — Documentación
- [forja-lang/examples](https://github.com/forja-lang/examples) — Ejemplos del lenguaje
