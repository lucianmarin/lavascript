# LavaScript — Pythonic TypeScript / JavaScript Bidirectional Transpiler

**LavaScript** is a human-readable, zero-overhead **1-to-1 syntactic representation of TypeScript and JavaScript** inspired by Python's clean naming, type annotations, comprehensions, and block indentation.

Just as **LMON is JSON and JSON is LMON**, **Pura is C/C++ and C/C++ is Pura**, and **Strata is Rust and Rust is Strata**, **LavaScript is TypeScript/JavaScript and TypeScript/JavaScript is LavaScript**. Every LavaScript construct maps directly and deterministically to an exact TypeScript/JavaScript equivalent—with **no curly braces (`{` `}`) for blocks**, **no trailing semicolons (`;`)**, **Pythonic function and variable declarations (`def`, `async def`, `name: type = val`, `var name: type = val`)**, **Pythonic type aliases (`str`, `num`, `bool`, `list[T]`, `set[T]`, `dict[K, V]`, `rec[K, V]`, `promise[T]`)**, **Pythonic f-strings (`f"Hello {name}"` ↔ `` `Hello ${name}` ``)**, **list, set, and dict comprehensions**, and **zero runtime overhead**.

- **Extension:** `.ls` (or `.lavascript`)
- **Target Language:** TypeScript / JavaScript (ES2022+)
- **Encoding:** UTF-8 (without BOM)

---

## Design Goals

1. **Bijective TypeScript/JavaScript Structural Equivalence:** Every LavaScript file transpiles 1-to-1 into clean, idiomatic TypeScript/JavaScript and converts back via `--from-ts` with zero hidden runtime or wrapper libraries.
2. **Pythonic Readability:**
   - Indentation-delimited blocks (`:`) instead of `{` and `}` (including automatic comma/brace termination on `interface`, `class`, `enum`, and `switch` blocks).
   - No statement-ending semicolons (`;`).
   - Python-style `[export] [async] def name(arg: type) -> ret_type:` functions/methods, `def __init__(self, ...):` constructors, and `name: type = value` (`const`) / `var name: type = value` (`let`) bindings.
   - Concise type aliases & generic containers: `str` (`string`), `num` (`number`), `bool` (`boolean`), `nil` (`null`), `list[T]` (`T[]`), `set[T]` (`Set<T>`), `dict[K, V]` (`Map<K, V>`), `rec[K, V]` (`Record<K, V>`), and `promise[T]` (`Promise<T>`).
   - Pythonic f-strings (`f"value = {x + 1}"` ↔ `` `value = ${x + 1}` ``), casts (`cast(Type, x)` ↔ `(x as Type)`), and conversion calls (`str(x)`, `num(x)`, `bool(x)` ↔ `String(x)`, `Number(x)`, `Boolean(x)`).
   - Pythonic keywords and operators (`elif`, `and`, `or`, `not`, `True`, `False`, `nil`, `self`, `pass`, `range(...)`, `print(...)` ↔ `console.log(...)`, `eprint(...)` ↔ `console.error(...)`, `==` ↔ `===`, `!=` ↔ `!==`).
   - Python-style list, set, and dict comprehensions (`[x * x for x in range(1, 7) if x % 2 == 0]`, `{x % 4 for x in range(10)}`, `{k: v for x in items}`).
   - `#` single-line comments, `from "mod" import a, b` module imports, and top-level `NAME = value` constants.
3. **Auto-Detected Indentation & Universal Newlines:** Supports any consistent indentation unit per file (`W` spaces or `W` tabs, locked on the first indented line) and universal line endings (`\n`, `\r\n`, `\r`).
4. **Zero-Dependency Single-File CLI:** [`lavascript.ts`](lavascript.ts) is a self-contained single-file TypeScript CLI that runs natively on Node.js (`v22.6+` / `v26+`) with zero external npm packages, transpiling at **370+ files/s (`30+ MiB/s`)**.

---

## Side-by-Side Comparison

### LavaScript (`.ls`)

```python
# Service node evaluator in LavaScript
MAX_GREETINGS = 3

enum Status:
    Ok = 0
    Err = 1

interface Point:
    x: num
    y: num

def clamp(val: num, lo: num, hi: num) -> num:
    if val < lo:
        return lo
    elif val > hi:
        return hi
    else:
        return val

def greet(name: str, count: num) -> num:
    if name == "" or count <= 0:
        return 0
    for i in range(count):
        print(f"[{i + 1}] Hello from LavaScript, {name}!")
    return count

def main() -> num:
    sent: num = greet("World", MAX_GREETINGS)
    if sent > 0 and not (sent > 10):
        print("Clamped:", clamp(sent, 0, 2))
    return 0
```

### Equivalent TypeScript (`.ts`)

```ts
// Service node evaluator in LavaScript
const MAX_GREETINGS = 3;

enum Status {
    Ok = 0,
    Err = 1,
}

interface Point {
    x: number;
    y: number;
}

function clamp(val: number, lo: number, hi: number): number {
    if (val < lo) {
        return lo;
    } else if (val > hi) {
        return hi;
    } else {
        return val;
    }
}

function greet(name: string, count: number): number {
    if (name === "" || count <= 0) {
        return 0;
    }
    for (let i = 0; i < count; i++) {
        console.log(`[${i + 1}] Hello from LavaScript, ${name}!`);
    }
    return count;
}

function main(): number {
    const sent: number = greet("World", MAX_GREETINGS);
    if (sent > 0 && !(sent > 10)) {
        console.log("Clamped:", clamp(sent, 0, 2));
    }
    return 0;
}
```

---

## LavaScript Specification

### 1. Encoding, Universal Newlines, and Auto-Detected Indentation

1. **UTF-8:** Source files MUST be valid UTF-8 without a byte-order mark (`U+FEFF` at byte 0 is a syntax error).
2. **Universal Newlines (`LF`, `CRLF`, `CR`):** LavaScript supports `\n`, `\r\n`, and `\r` line endings interchangeably outside string literals.
3. **Blank Lines:** Lines containing zero characters or only ASCII spaces (`0x20`) and/or tabs (`0x09`) before a line ending are preserved as blank lines without affecting indentation tracking.
4. **Auto-Detected Indentation (Spaces or Tabs):**
   - Root declarations sit at indentation level `0`.
   - The **first indented non-blank line** locks the file's `indent_unit` to either `W` ASCII spaces (`0x20`) or `W` ASCII tabs (`0x09`).
   - Every subsequent non-blank line MUST indent by an exact multiple `N * indent_unit` (`level = count / W`).
   - Mixing spaces and tabs in indentation, jumping more than one indentation level after a `:` block header, or leaving a dangling `:` block header without an indented body is a **syntax error**.
5. **No Trailing Whitespace:** Non-blank lines MUST NOT contain trailing spaces or tabs before the line ending.

---

### 2. Comments and Module Imports

| LavaScript Syntax | TypeScript Equivalent | Notes |
| :--- | :--- | :--- |
| `# comment text` | `// comment text` | Full-line or inline comment (preceded by space outside quotes). |
| `from "node:fs" import readFileSync, writeFileSync` | `import { readFileSync, writeFileSync } from "node:fs";` | Named ES module imports. |
| `from "node:fs" import * as fs` | `import * as fs from "node:fs";` | Namespace ES module import. |
| `import express from "express"` | `import express from "express";` | Default ES module import. |
| `import "./polyfills.js"` | `import "./polyfills.js";` | Side-effect module import. |
| `MAX_LEN = 1024` | `const MAX_LEN = 1024;` | Top-level untyped assignment defines a `const`. |

---

### 3. Variable, Constant & Field Declarations

LavaScript defaults to immutable `const` bindings while making mutable `let` bindings explicit with `var`:

| LavaScript Syntax | TypeScript Equivalent | Description |
| :--- | :--- | :--- |
| `count: num = 42` | `const count: number = 42;` | Immutable typed constant (`const`). |
| `var retries: num = 3` | `let retries: number = 3;` | Mutable typed variable (`let`). |
| `var total = 0` | `let total = 0;` | Mutable type-inferred variable (`let`). |
| `const PI = 3.14159` | `const PI = 3.14159;` | Local untyped constant (`const`). |
| `export API_VERSION: str = "v1"` | `export const API_VERSION: string = "v1";` | Exported constant. |

---

### 4. Functions, Async Functions, and Class Methods (`def`)

```python
export def add(a: num, b: num = 0) -> num:
    return a + b

export async def fetch_name(id: num) -> str:
    return f"user-{id}"
```

Transpiles to:

```ts
export function add(a: number, b: number = 0): number {
    return a + b;
}

export async function fetch_name(id: number): Promise<string> {
    return `user-${id}`;
}
```

- Generic parameters use bracket syntax `def identity[T](x: T) -> T:` ↔ `function identity<T>(x: T): T`.
- Inside `class` blocks, `def __init__(self, ...):` maps to `constructor(...)`, and methods drop the leading `self` parameter while mapping `self.field` ↔ `this.field`.

---

### 5. Interfaces, Classes, Enums, and Type Aliases

```python
enum ShapeKind:
    Circle = 0
    Rectangle = 1

interface Vec2:
    x: num
    y: num

class Shape(BaseShape):
    kind: ShapeKind
    width: num

    def __init__(self, kind: ShapeKind, width: num):
        self.kind = kind
        self.width = width

    def area(self) -> num:
        return self.width * self.width

type ShapeMap = dict[str, Shape]
```

Transpiles to:

```ts
enum ShapeKind {
    Circle = 0,
    Rectangle = 1,
}

interface Vec2 {
    x: number;
    y: number;
}

class Shape extends BaseShape {
    kind: ShapeKind;
    width: number;

    constructor(kind: ShapeKind, width: number) {
        this.kind = kind;
        this.width = width;
    }

    area(): number {
        return this.width * this.width;
    }
}

type ShapeMap = Map<string, Shape>;
```

---

### 6. Control Flow, `range()` Loops, `switch`, and `try` / `except`

| LavaScript Syntax | TypeScript Equivalent |
| :--- | :--- |
| `if cond:` | `if (cond) {` |
| `elif cond:` | `} else if (cond) {` |
| `else:` | `} else {` |
| `while cond:` | `while (cond) {` |
| `for i in range(n):` | `for (let i = 0; i < n; i++) {` |
| `for i in range(start, stop):` | `for (let i = start; i < stop; i++) {` |
| `for i in range(start, stop, step):` | `for (let i = start; i < stop; i += step) {` |
| `for item in items:` | `for (const item of items) {` |
| `switch expr:` / `match expr:` | `switch (expr) {` |
| `case VAL:` / `default:` | `case VAL:` / `default:` |
| `try:` / `except err:` / `finally:` | `try {` / `} catch (err) {` / `} finally {` |
| `pass` | *(no-op placeholder for empty blocks)* |

---

### 7. List, Set, and Dict Comprehensions

LavaScript supports Python-style **list**, **set**, and **dict** comprehensions that transpile 1-to-1 to idiomatic TypeScript/JavaScript array/collection pipelines and round-trip back via `--from-ts` / `--lavascript`:

| Comprehension Kind | LavaScript Syntax | TypeScript Equivalent |
| :--- | :--- | :--- |
| **List (`list[T]`)** | `squares: list[num] = [x * x for x in range(1, 7) if x % 2 == 0]` | `const squares: number[] = Array.from({ length: 7 - 1 }, (_, x) => 1 + x).filter(x => x % 2 === 0).map(x => x * x);` |
| **List (from iterable)** | `doubled: list[num] = [x * 2 for x in squares if x > 4]` | `const doubled: number[] = squares.filter(x => x > 4).map(x => x * 2);` |
| **Set (`set[T]`)** | `uniq: set[num] = {x % 4 for x in range(10)}` | `const uniq: Set<number> = new Set(Array.from({ length: 10 }, (_, x) => x).map(x => x % 4));` |
| **Dict (`dict[K, V]` / `Map`)** | `lookup: dict[num, num] = {x: x * 10 for x in squares if x > 0}` | `const lookup: Map<number, number> = new Map(squares.filter(x => x > 0).map(x => [x, x * 10]));` |
| **Dict (`rec[K, V]` / `Record`)** | `rec_map: rec[str, num] = {f"k{x}": x * 2 for x in squares if x > 0}` | `const rec_map: Record<string, number> = Object.fromEntries(squares.filter(x => x > 0).map(x => [`k${x}`, x * 2]));` |

---

### 8. Keywords, Operators, Built-ins, and Type Aliases

| LavaScript | TypeScript | LavaScript | TypeScript |
| :--- | :--- | :--- | :--- |
| `and` | `&&` | `str` | `string` |
| `or` | `\|\|` | `num` | `number` |
| `not x` | `!x` | `bool` | `boolean` |
| `==` / `!=` | `===` / `!==` | `nil` / `None` | `null` |
| `True` / `False` | `true` / `false` | `self` | `this` |
| `list[T]` | `T[]` | `set[T]` | `Set<T>` |
| `dict[K, V]` | `Map<K, V>` | `rec[K, V]` | `Record<K, V>` |
| `promise[T]` | `Promise<T>` | `cast(T, x)` | `(x as T)` |
| `print(a, b)` | `console.log(a, b)` | `eprint(a, b)` | `console.error(a, b)` |
| `str(x)` / `num(x)` / `bool(x)` | `String(x)` / `Number(x)` / `Boolean(x)` | `f"hi {name}"` | `` `hi ${name}` `` |

---

## Building and Using the `lavascript` CLI

### Build & Run Conformance Suite

```sh
make
make test
make bench
```

### CLI Commands

```sh
# 1. Transpile LavaScript (.ls) to TypeScript on stdout (or -o file.ts)
./lavascript examples/hello.ls
./lavascript examples/shapes.ls -o shapes.ts

# 2. Transpile and execute a LavaScript program directly with Node.js
./lavascript --run examples/hello.ls
./lavascript --run examples/shapes.ls
./lavascript --run examples/comprehensions.ls
./lavascript --run examples/tabs.ls

# 3. Format/canonicalize LavaScript (choose 2 spaces, 4 spaces, or tabs)
./lavascript --lavascript examples/hello.ls
./lavascript --lavascript --indent 2 examples/hello.ls
./lavascript --lavascript --indent tab examples/hello.ls

# 4. Convert existing TypeScript/JavaScript source into LavaScript
./lavascript --from-ts shapes.ts -o shapes.ls

# 5. Validate LavaScript syntax and indentation rules
./lavascript --check examples/hello.ls
```

---

## Benchmark Results

Measured on a 250-function synthetic module (`./lavascript --bench`):

| Metric | Result |
| :--- | :--- |
| **TypeScript source size** | `98,376 bytes` (`96.1 KiB`) |
| **LavaScript (4-space indent) size** | `84,107 bytes` (`82.1 KiB`, **-14.5% smaller than TS**) |
| **LavaScript (`\t` tab indent) size** | `72,595 bytes` (`70.9 KiB`, **-26.2% smaller than TS**) |
| **Transpilation speed (LavaScript 4-space → TS)** | **~375 files/s** (`30.0 MiB/s`) |
| **Transpilation speed (LavaScript tab → TS)** | **~385 files/s** (`26.5 MiB/s`) |
| **Reverse conversion (TS → LavaScript)** | **~285 files/s** (`26.8 MiB/s`) |

---

## Repository Layout

- [`lavascript.ts`](lavascript.ts) — Single-file bidirectional LavaScript ↔ TypeScript transpiler, runner, formatter, test suite, and benchmark.
- [`examples/hello.ls`](examples/hello.ls) — Introductory example (`def`, `range`, list comprehension, `f"..."`, `and`/`or`/`not`).
- [`examples/shapes.ls`](examples/shapes.ls) — `enum`, `interface`, `class`, methods, and `switch`/`case`.
- [`examples/comprehensions.ls`](examples/comprehensions.ls) — List, Set, Map (`dict`), and Record (`rec`) comprehensions.
- [`examples/tabs.ls`](examples/tabs.ls) — Tab-indented (`\t`) Fibonacci example demonstrating auto-detected tab indentation.
- [`Makefile`](Makefile) — Build, test, benchmark, and install targets.
- [`LICENSE`](LICENSE) — MIT License.
