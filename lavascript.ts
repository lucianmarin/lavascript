#!/usr/bin/env node
// LavaScript — Pythonic TypeScript / JavaScript Bidirectional Transpiler (.ls <-> .ts)
//
// Features:
//   - Auto-detected indentation (any consistent number of spaces or tabs)
//   - Universal newlines (\n, \r\n, \r)
//   - Bijective 1-to-1 LavaScript <-> TypeScript/JavaScript conversion
//   - Pythonic `def`, `async def`, `class`, `interface`, `enum`, `type`
//   - Concise types (`str`, `num`, `bool`, `list[T]`, `set[T]`, `dict[K, V]`, `rec[K, V]`, `promise[T]`)
//   - List, Set, and Dict comprehensions (`[x * 2 for x in ...]`, `{x for ...}`, `{k: v for ...}`)
//   - Standalone CLI (`--run`, `--lavascript`, `--from-ts`, `--indent`, `--check`, `--test`, `--bench`)

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

export interface LavaScriptError {
    message: string;
    line: number;
    col: number;
}

class LavaScriptSyntaxError extends Error {
    line: number;
    col: number;
    constructor(message: string, line: number, col: number = 1) {
        super(message);
        this.line = line;
        this.col = col;
    }
}

const TYPE_MAP_LS_TO_TS: Record<string, string> = {
    str: "string",
    num: "number",
    bool: "boolean",
    any: "any",
    void: "void",
    never: "never",
    unknown: "unknown",
    nil: "null",
    None: "null",
};

const TYPE_MAP_TS_TO_LS: Record<string, string> = {
    string: "str",
    number: "num",
    boolean: "bool",
    any: "any",
    void: "void",
    never: "never",
    unknown: "unknown",
    null: "nil",
};

function isIdentStart(ch: string): boolean {
    if (!ch) return false;
    const c = ch.charCodeAt(0);
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
}

function isIdentCont(ch: string): boolean {
    if (!ch) return false;
    const c = ch.charCodeAt(0);
    return isIdentStart(ch) || (c >= 48 && c <= 57);
}

function startsWithKw(s: string, kw: string): string | null {
    if (!s.startsWith(kw)) return null;
    if (s.length === kw.length) return "";
    const next = s[kw.length];
    if (next === " " || next === "\t" || next === "(" || next === ":") {
        return s.slice(kw.length).trimStart();
    }
    return null;
}

export function findMatchingDelim(
    s: string,
    openIdx: number,
    openCh: string,
    closeCh: string
): number {
    let depth = 0;
    let quote = "";
    for (let i = openIdx; i < s.length; i++) {
        const c = s[i];
        if (quote) {
            if (c === "\\" && i + 1 < s.length) {
                i++;
            } else if (c === quote) {
                quote = "";
            }
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            quote = c;
            continue;
        }
        if (c === openCh) {
            depth++;
        } else if (c === closeCh) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function splitTopLevel(s: string, sep: string, trackAngles: boolean = true): string[] {
    const out: string[] = [];
    let depth = 0;
    let quote = "";
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quote) {
            if (c === "\\" && i + 1 < s.length) i++;
            else if (c === quote) quote = "";
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            quote = c;
            continue;
        }
        if (c === "(" || c === "[" || c === "{" || (trackAngles && c === "<")) depth++;
        else if (c === ")" || c === "]" || c === "}" || (trackAngles && c === ">")) {
            if (depth > 0) depth--;
        } else if (depth === 0 && s.startsWith(sep, i)) {
            out.push(s.slice(start, i));
            i += sep.length - 1;
            start = i + 1;
        }
    }
    out.push(s.slice(start));
    return out;
}

function findTopLevelToken(s: string, token: string, fromIdx: number = 0): number {
    let depth = 0;
    let quote = "";
    for (let i = fromIdx; i + token.length <= s.length; i++) {
        const c = s[i];
        if (quote) {
            if (c === "\\" && i + 1 < s.length) i++;
            else if (c === quote) quote = "";
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            quote = c;
            continue;
        }
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") {
            if (depth > 0) depth--;
        } else if (depth === 0 && s.startsWith(token, i)) {
            return i;
        }
    }
    return -1;
}

/* -------------------------------------------------------------------------
 * Type Translation (LavaScript <-> TypeScript)
 * ------------------------------------------------------------------------- */

export function translateTypeLavaScriptToTs(raw: string): string {
    const s = raw.trim();
    if (!s) return s;

    // Top-level union `A | B`
    const unionParts = splitTopLevel(s, "|");
    if (unionParts.length > 1) {
        return unionParts.map((p) => translateTypeLavaScriptToTs(p)).join(" | ");
    }

    if (TYPE_MAP_LS_TO_TS[s] !== undefined) {
        return TYPE_MAP_LS_TO_TS[s];
    }

    // `list[T]` -> `T[]` (or `Array<T>` if T is a union)
    if (s.startsWith("list[") && findMatchingDelim(s, 4, "[", "]") === s.length - 1) {
        const inner = translateTypeLavaScriptToTs(s.slice(5, -1));
        return inner.includes(" | ") ? `(${inner})[]` : `${inner}[]`;
    }

    // `set[T]` -> `Set<T>`
    if (s.startsWith("set[") && findMatchingDelim(s, 3, "[", "]") === s.length - 1) {
        return `Set<${translateTypeLavaScriptToTs(s.slice(4, -1))}>`;
    }

    // `promise[T]` -> `Promise<T>`
    if (s.startsWith("promise[") && findMatchingDelim(s, 7, "[", "]") === s.length - 1) {
        return `Promise<${translateTypeLavaScriptToTs(s.slice(8, -1))}>`;
    }

    // `dict[K, V]` -> `Map<K, V>`
    if (s.startsWith("dict[") && findMatchingDelim(s, 4, "[", "]") === s.length - 1) {
        const args = splitTopLevel(s.slice(5, -1), ",");
        if (args.length === 2) {
            return `Map<${translateTypeLavaScriptToTs(args[0])}, ${translateTypeLavaScriptToTs(args[1])}>`;
        }
    }

    // `rec[K, V]` -> `Record<K, V>`
    if (s.startsWith("rec[") && findMatchingDelim(s, 3, "[", "]") === s.length - 1) {
        const args = splitTopLevel(s.slice(4, -1), ",");
        if (args.length === 2) {
            return `Record<${translateTypeLavaScriptToTs(args[0])}, ${translateTypeLavaScriptToTs(args[1])}>`;
        }
    }

    // Tuple `[A, B]`
    if (s.startsWith("[") && findMatchingDelim(s, 0, "[", "]") === s.length - 1) {
        const args = splitTopLevel(s.slice(1, -1), ",");
        return `[${args.map((a) => translateTypeLavaScriptToTs(a)).join(", ")}]`;
    }

    // Generic `Name[A, B]` -> `Name<A, B>`
    const bIdx = s.indexOf("[");
    if (bIdx > 0 && findMatchingDelim(s, bIdx, "[", "]") === s.length - 1) {
        const base = s.slice(0, bIdx).trim();
        const inner = s.slice(bIdx + 1, -1).trim();
        if (inner.length > 0 && /^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(base)) {
            const args = splitTopLevel(inner, ",");
            return `${base}<${args.map((a) => translateTypeLavaScriptToTs(a)).join(", ")}>`;
        }
    }

    return s;
}

export function translateTypeTsToLavaScript(raw: string): string {
    const s = raw.trim();
    if (!s) return s;

    const unionParts = splitTopLevel(s, "|");
    if (unionParts.length > 1) {
        return unionParts.map((p) => translateTypeTsToLavaScript(p)).join(" | ");
    }

    if (TYPE_MAP_TS_TO_LS[s] !== undefined) {
        return TYPE_MAP_TS_TO_LS[s];
    }

    // `T[]` or `(A | B)[]` -> `list[T]`
    if (s.endsWith("[]")) {
        let base = s.slice(0, -2).trim();
        if (base.startsWith("(") && findMatchingDelim(base, 0, "(", ")") === base.length - 1) {
            base = base.slice(1, -1);
        }
        return `list[${translateTypeTsToLavaScript(base)}]`;
    }

    // `Array<T>` -> `list[T]`
    if (s.startsWith("Array<") && findMatchingDelim(s, 5, "<", ">") === s.length - 1) {
        return `list[${translateTypeTsToLavaScript(s.slice(6, -1))}]`;
    }

    // `Set<T>` -> `set[T]`
    if (s.startsWith("Set<") && findMatchingDelim(s, 3, "<", ">") === s.length - 1) {
        return `set[${translateTypeTsToLavaScript(s.slice(4, -1))}]`;
    }

    // `Promise<T>` -> `promise[T]`
    if (s.startsWith("Promise<") && findMatchingDelim(s, 7, "<", ">") === s.length - 1) {
        return `promise[${translateTypeTsToLavaScript(s.slice(8, -1))}]`;
    }

    // `Map<K, V>` -> `dict[K, V]`
    if (s.startsWith("Map<") && findMatchingDelim(s, 3, "<", ">") === s.length - 1) {
        const args = splitTopLevel(s.slice(4, -1), ",");
        if (args.length === 2) {
            return `dict[${translateTypeTsToLavaScript(args[0])}, ${translateTypeTsToLavaScript(args[1])}]`;
        }
    }

    // `Record<K, V>` -> `rec[K, V]`
    if (s.startsWith("Record<") && findMatchingDelim(s, 6, "<", ">") === s.length - 1) {
        const args = splitTopLevel(s.slice(7, -1), ",");
        if (args.length === 2) {
            return `rec[${translateTypeTsToLavaScript(args[0])}, ${translateTypeTsToLavaScript(args[1])}]`;
        }
    }

    // Tuple `[A, B]`
    if (s.startsWith("[") && findMatchingDelim(s, 0, "[", "]") === s.length - 1) {
        const args = splitTopLevel(s.slice(1, -1), ",");
        return `[${args.map((a) => translateTypeTsToLavaScript(a)).join(", ")}]`;
    }

    // Generic `Name<A, B>` -> `Name[A, B]`
    const gIdx = s.indexOf("<");
    if (gIdx > 0 && findMatchingDelim(s, gIdx, "<", ">") === s.length - 1) {
        const base = s.slice(0, gIdx).trim();
        const args = splitTopLevel(s.slice(gIdx + 1, -1), ",");
        return `${base}[${args.map((a) => translateTypeTsToLavaScript(a)).join(", ")}]`;
    }

    return s;
}

/* -------------------------------------------------------------------------
 * Comprehension Translation (LavaScript <-> TypeScript)
 * ------------------------------------------------------------------------- */

function emitRangeArrayTs(rangeArgs: string, loopVar: string): string | null {
    const parts = splitTopLevel(rangeArgs, ",").map((p) => translateTokensLavaScriptToTs(p.trim()));
    if (parts.length === 1) {
        return `Array.from({ length: ${parts[0]} }, (_, ${loopVar}) => ${loopVar})`;
    }
    if (parts.length === 2) {
        return `Array.from({ length: ${parts[1]} - ${parts[0]} }, (_, ${loopVar}) => ${parts[0]} + ${loopVar})`;
    }
    return null;
}

export function tryTranslateComprehensionLavaScriptToTs(
    expr: string,
    targetTypeLavaScript?: string
): string | null {
    const s = expr.trim();
    if (s.length < 2) return null;

    let isBracket = false;
    if (s[0] === "[" && findMatchingDelim(s, 0, "[", "]") === s.length - 1) {
        isBracket = true;
    } else if (s[0] === "{" && findMatchingDelim(s, 0, "{", "}") === s.length - 1) {
        isBracket = false;
    } else {
        return null;
    }

    const inner = s.slice(1, -1);
    const forIdx = findTopLevelToken(inner, " for ");
    if (forIdx < 0) return null;

    const head = inner.slice(0, forIdx).trim();
    const afterFor = inner.slice(forIdx + 5);
    const inIdx = findTopLevelToken(afterFor, " in ");
    if (inIdx < 0 || !head) return null;

    const ifIdx = findTopLevelToken(afterFor, " if ", inIdx + 4);
    const rawVar = afterFor.slice(0, inIdx).trim();
    const loopVar = rawVar.includes(":") ? rawVar.slice(0, rawVar.indexOf(":")).trim() : rawVar;
    if (!loopVar) return null;

    const iterRaw = (ifIdx >= 0 ? afterFor.slice(inIdx + 4, ifIdx) : afterFor.slice(inIdx + 4)).trim();
    const condRaw = ifIdx >= 0 ? afterFor.slice(ifIdx + 4).trim() : null;
    if (!iterRaw || (condRaw !== null && !condRaw)) return null;

    let baseTs: string;
    if (iterRaw.startsWith("range(") && findMatchingDelim(iterRaw, 5, "(", ")") === iterRaw.length - 1) {
        const r = emitRangeArrayTs(iterRaw.slice(6, -1), loopVar);
        if (!r) return null;
        baseTs = r;
    } else {
        baseTs = translateTokensLavaScriptToTs(iterRaw);
    }

    if (condRaw !== null) {
        baseTs += `.filter(${loopVar} => ${translateTokensLavaScriptToTs(condRaw)})`;
    }

    if (isBracket) {
        const elemTs = translateTokensLavaScriptToTs(head);
        return `${baseTs}.map(${loopVar} => ${elemTs})`;
    }

    // Distinguish `{k: v for ...}` (dict/rec) from `{elem for ...}` (set)
    let colonIdx = -1;
    let depth = 0;
    let quote = "";
    let qmarkDepth = 0;
    for (let i = 0; i < head.length; i++) {
        const c = head[i];
        if (quote) {
            if (c === "\\" && i + 1 < head.length) i++;
            else if (c === quote) quote = "";
            continue;
        }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        else if (depth === 0) {
            if (c === "?") qmarkDepth++;
            else if (c === ":") {
                if (qmarkDepth > 0) qmarkDepth--;
                else {
                    colonIdx = i;
                    break;
                }
            }
        }
    }

    if (colonIdx >= 0) {
        const keyTs = translateTokensLavaScriptToTs(head.slice(0, colonIdx).trim());
        const valTs = translateTokensLavaScriptToTs(head.slice(colonIdx + 1).trim());
        const t = (targetTypeLavaScript || "").trim();
        const isRecord = t.startsWith("rec[") || t.startsWith("Record<");
        const wrapper = isRecord ? "Object.fromEntries" : "new Map";
        return `${wrapper}(${baseTs}.map(${loopVar} => [${keyTs}, ${valTs}]))`;
    } else {
        const elemTs = translateTokensLavaScriptToTs(head);
        return `new Set(${baseTs}.map(${loopVar} => ${elemTs}))`;
    }
}

export function tryTranslateComprehensionTsToLavaScript(expr: string): string | null {
    const s = expr.trim();
    let kind: "list" | "set" | "dict" = "list";
    let chain = s;

    if (s.startsWith("new Set(") && findMatchingDelim(s, 7, "(", ")") === s.length - 1) {
        kind = "set";
        chain = s.slice(8, -1).trim();
    } else if (s.startsWith("new Map(") && findMatchingDelim(s, 7, "(", ")") === s.length - 1) {
        kind = "dict";
        chain = s.slice(8, -1).trim();
    } else if (
        s.startsWith("Object.fromEntries(") &&
        findMatchingDelim(s, 18, "(", ")") === s.length - 1
    ) {
        kind = "dict";
        chain = s.slice(19, -1).trim();
    }

    // Must end with `.map(v => ...)` at top level
    const mapIdx = findLastTopLevelMethod(chain, ".map(");
    if (mapIdx < 0) return null;
    if (findMatchingDelim(chain, mapIdx + 4, "(", ")") !== chain.length - 1) return null;

    const mapArg = chain.slice(mapIdx + 5, -1).trim();
    const arrowIdx = mapArg.indexOf("=>");
    if (arrowIdx < 0) return null;
    const loopVar = mapArg.slice(0, arrowIdx).trim().replace(/^\(|\)$/g, "").trim();
    const mapBody = mapArg.slice(arrowIdx + 2).trim();
    if (!loopVar || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(loopVar)) return null;

    let beforeMap = chain.slice(0, mapIdx).trim();
    let condLavaScript: string | null = null;

    const filterIdx = findLastTopLevelMethod(beforeMap, ".filter(");
    if (filterIdx >= 0 && findMatchingDelim(beforeMap, filterIdx + 7, "(", ")") === beforeMap.length - 1) {
        const filterArg = beforeMap.slice(filterIdx + 8, -1).trim();
        const fArrow = filterArg.indexOf("=>");
        if (fArrow > 0) {
            const fVar = filterArg.slice(0, fArrow).trim().replace(/^\(|\)$/g, "").trim();
            if (fVar === loopVar) {
                condLavaScript = translateTokensTsToLavaScript(filterArg.slice(fArrow + 2).trim());
                beforeMap = beforeMap.slice(0, filterIdx).trim();
            }
        }
    }

    // Decode `Array.from({ length: ... }, (_, x) => ...)` back to `range(...)`
    let iterLavaScript: string;
    const rangeMatch =
        /^Array\.from\(\{\s*length:\s*(.+?)\s*\},\s*\(_,\s*([A-Za-z_$][A-Za-z0-9_$]*)\)\s*=>\s*(.+?)\)$/.exec(
            beforeMap
        );
    if (rangeMatch && rangeMatch[2] === loopVar) {
        const lenExpr = rangeMatch[1].trim();
        const stepExpr = rangeMatch[3].trim();
        if (stepExpr === loopVar) {
            iterLavaScript = `range(${translateTokensTsToLavaScript(lenExpr)})`;
        } else if (stepExpr.endsWith(`+ ${loopVar}`)) {
            const startRaw = stepExpr.slice(0, -(`+ ${loopVar}`).length).trim();
            const suffix = `- ${startRaw}`;
            const stopRaw = lenExpr.endsWith(suffix)
                ? lenExpr.slice(0, -suffix.length).trim()
                : lenExpr;
            iterLavaScript = `range(${translateTokensTsToLavaScript(startRaw)}, ${translateTokensTsToLavaScript(stopRaw)})`;
        } else {
            iterLavaScript = translateTokensTsToLavaScript(beforeMap);
        }
    } else {
        iterLavaScript = translateTokensTsToLavaScript(beforeMap);
    }

    const condSuffix = condLavaScript ? ` if ${condLavaScript}` : "";

    if (kind === "dict") {
        if (
            !mapBody.startsWith("[") ||
            findMatchingDelim(mapBody, 0, "[", "]") !== mapBody.length - 1
        ) {
            return null;
        }
        const kv = splitTopLevel(mapBody.slice(1, -1), ",");
        if (kv.length !== 2) return null;
        const kLavaScript = translateTokensTsToLavaScript(kv[0].trim());
        const vLavaScript = translateTokensTsToLavaScript(kv[1].trim());
        return `{${kLavaScript}: ${vLavaScript} for ${loopVar} in ${iterLavaScript}${condSuffix}}`;
    }

    const elemLavaScript = translateTokensTsToLavaScript(mapBody);
    if (kind === "set") {
        return `{${elemLavaScript} for ${loopVar} in ${iterLavaScript}${condSuffix}}`;
    }
    return `[${elemLavaScript} for ${loopVar} in ${iterLavaScript}${condSuffix}]`;
}

function findLastTopLevelMethod(s: string, methodPrefix: string): number {
    let depth = 0;
    let quote = "";
    let last = -1;
    for (let i = 0; i + methodPrefix.length <= s.length; i++) {
        const c = s[i];
        if (quote) {
            if (c === "\\" && i + 1 < s.length) i++;
            else if (c === quote) quote = "";
            continue;
        }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") {
            if (depth > 0) depth--;
        } else if (depth === 0 && s.startsWith(methodPrefix, i)) {
            last = i;
        }
    }
    return last;
}

/* -------------------------------------------------------------------------
 * Token-Level Expression Translation (LavaScript <-> TypeScript)
 * ------------------------------------------------------------------------- */

export function translateTokensLavaScriptToTs(s: string): string {
    const trimmed = s.trim();
    const comp = tryTranslateComprehensionLavaScriptToTs(trimmed);
    if (comp !== null && s === trimmed) return comp;

    let out = "";
    let i = 0;
    while (i < s.length) {
        const c = s[i];

        // Preserve string / template literals
        if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            out += c;
            i++;
            while (i < s.length) {
                const sc = s[i];
                if (sc === "\\" && i + 1 < s.length) {
                    out += sc + s[i + 1];
                    i += 2;
                    continue;
                }
                if (quote === "`" && sc === "$" && s[i + 1] === "{") {
                    const closeB = findMatchingDelim(s, i + 1, "{", "}");
                    if (closeB > i + 1) {
                        out += "${" + translateTokensLavaScriptToTs(s.slice(i + 2, closeB).trim()) + "}";
                        i = closeB + 1;
                        continue;
                    }
                }
                out += sc;
                i++;
                if (sc === quote) {
                    break;
                }
            }
            continue;
        }

        // `==` -> `===` and `!=` -> `!==` (unless already `===` / `!==`)
        if (c === "=" && s[i + 1] === "=" && s[i + 2] !== "=" && s[i - 1] !== "=" && s[i - 1] !== "!") {
            out += "===";
            i += 2;
            continue;
        }
        if (c === "!" && s[i + 1] === "=" && s[i + 2] !== "=") {
            out += "!==";
            i += 2;
            continue;
        }

        if (isIdentStart(c)) {
            const start = i;
            while (i < s.length && isIdentCont(s[i])) i++;
            const word = s.slice(start, i);
            const isMember = start > 0 && s[start - 1] === ".";

            if (!isMember) {
                // `f"Hello {name}"` -> `` `Hello ${name}` ``
                if (word === "f" && i < s.length && (s[i] === '"' || s[i] === "'")) {
                    const quote = s[i];
                    i++;
                    let tpl = "`";
                    while (i < s.length && s[i] !== quote) {
                        if (s[i] === "\\" && i + 1 < s.length) {
                            tpl += s[i] + s[i + 1];
                            i += 2;
                            continue;
                        }
                        if (s[i] === "{") {
                            const closeB = findMatchingDelim(s, i, "{", "}");
                            if (closeB > i) {
                                const innerExpr = translateTokensLavaScriptToTs(
                                    s.slice(i + 1, closeB).trim()
                                );
                                tpl += "${" + innerExpr + "}";
                                i = closeB + 1;
                                continue;
                            }
                        }
                        tpl += s[i];
                        i++;
                    }
                    if (i < s.length && s[i] === quote) i++;
                    tpl += "`";
                    out += tpl;
                    continue;
                }

                // `cast(Type, expr)` -> `(expr as Type)`
                if (word === "cast" && i < s.length && s[i] === "(") {
                    const closeP = findMatchingDelim(s, i, "(", ")");
                    if (closeP > i) {
                        const args = splitTopLevel(s.slice(i + 1, closeP), ",");
                        if (args.length === 2) {
                            const tsType = translateTypeLavaScriptToTs(args[0].trim());
                            const tsExpr = translateTokensLavaScriptToTs(args[1].trim());
                            out += `(${tsExpr} as ${tsType})`;
                            i = closeP + 1;
                            continue;
                        }
                    }
                }

                // `print(...)` -> `console.log(...)` and `eprint(...)` -> `console.error(...)`
                if ((word === "print" || word === "eprint") && i < s.length && s[i] === "(") {
                    const closeP = findMatchingDelim(s, i, "(", ")");
                    if (closeP > i) {
                        const fn = word === "print" ? "console.log" : "console.error";
                        const inner = splitTopLevel(s.slice(i + 1, closeP), ",")
                            .map((a) => translateTokensLavaScriptToTs(a.trim()))
                            .join(", ");
                        out += `${fn}(${inner})`;
                        i = closeP + 1;
                        continue;
                    }
                }

                // `str(x)`, `num(x)`, `bool(x)` -> `String(x)`, `Number(x)`, `Boolean(x)`
                if ((word === "str" || word === "num" || word === "bool") && i < s.length && s[i] === "(") {
                    const closeP = findMatchingDelim(s, i, "(", ")");
                    if (closeP > i) {
                        const ctor =
                            word === "str" ? "String" : word === "num" ? "Number" : "Boolean";
                        const inner = translateTokensLavaScriptToTs(s.slice(i + 1, closeP));
                        out += `${ctor}(${inner})`;
                        i = closeP + 1;
                        continue;
                    }
                }

                if (word === "and") {
                    out += "&&";
                    continue;
                }
                if (word === "or") {
                    out += "||";
                    continue;
                }
                if (word === "not") {
                    out += "!";
                    if (i < s.length && s[i] === " ") i++;
                    continue;
                }
                if (word === "nil" || word === "None") {
                    out += "null";
                    continue;
                }
                if (word === "True") {
                    out += "true";
                    continue;
                }
                if (word === "False") {
                    out += "false";
                    continue;
                }
                if (word === "self") {
                    out += "this";
                    continue;
                }
            }

            out += word;
            continue;
        }

        out += c;
        i++;
    }
    return out;
}

export function translateTokensTsToLavaScript(s: string): string {
    const trimmed = s.trim();
    const comp = tryTranslateComprehensionTsToLavaScript(trimmed);
    if (comp !== null && s === trimmed) return comp;

    let out = "";
    let i = 0;
    while (i < s.length) {
        const c = s[i];

        if (c === "`") {
            // Convert template literal `` `...${x}...` `` -> `f"...{x}..."`
            let j = i + 1;
            let hasInterp = false;
            let fBody = "";
            while (j < s.length && s[j] !== "`") {
                if (s[j] === "\\" && j + 1 < s.length) {
                    fBody += s[j] + s[j + 1];
                    j += 2;
                    continue;
                }
                if (s[j] === "$" && s[j + 1] === "{") {
                    const closeB = findMatchingDelim(s, j + 1, "{", "}");
                    if (closeB > j + 1) {
                        hasInterp = true;
                        fBody +=
                            "{" +
                            translateTokensTsToLavaScript(s.slice(j + 2, closeB).trim()) +
                            "}";
                        j = closeB + 1;
                        continue;
                    }
                }
                fBody += s[j];
                j++;
            }
            if (j < s.length && s[j] === "`") {
                out += hasInterp ? `f"${fBody}"` : `"${fBody}"`;
                i = j + 1;
                continue;
            }
        }

        if (c === '"' || c === "'") {
            const quote = c;
            out += c;
            i++;
            while (i < s.length) {
                const sc = s[i];
                out += sc;
                i++;
                if (sc === "\\" && i < s.length) {
                    out += s[i];
                    i++;
                } else if (sc === quote) {
                    break;
                }
            }
            continue;
        }

        // `(expr as Type)` -> `cast(Type, expr)`
        if (c === "(") {
            const closeP = findMatchingDelim(s, i, "(", ")");
            if (closeP > i + 1) {
                const inner = s.slice(i + 1, closeP);
                const asIdx = findTopLevelToken(inner, " as ");
                if (asIdx > 0) {
                    const exprPart = translateTokensTsToLavaScript(inner.slice(0, asIdx).trim());
                    const typePart = translateTypeTsToLavaScript(inner.slice(asIdx + 4).trim());
                    out += `cast(${typePart}, ${exprPart})`;
                    i = closeP + 1;
                    continue;
                }
            }
        }

        // `===` -> `==`, `!==` -> `!=`
        if (s.startsWith("===", i)) {
            out += "==";
            i += 3;
            continue;
        }
        if (s.startsWith("!==", i)) {
            out += "!=";
            i += 3;
            continue;
        }

        // `&&` -> `and`, `||` -> `or`, `!` -> `not `
        if (s.startsWith("&&", i)) {
            out += "and";
            i += 2;
            continue;
        }
        if (s.startsWith("||", i)) {
            out += "or";
            i += 2;
            continue;
        }
        if (c === "!" && s[i + 1] !== "=") {
            out += "not ";
            i++;
            continue;
        }

        // `console.log(` -> `print(`, `console.error(` -> `eprint(`
        if (s.startsWith("console.log(", i) || s.startsWith("console.error(", i)) {
            const isLog = s.startsWith("console.log(", i);
            const openIdx = i + (isLog ? 11 : 13);
            const closeP = findMatchingDelim(s, openIdx, "(", ")");
            if (closeP > openIdx) {
                const fn = isLog ? "print" : "eprint";
                const inner = splitTopLevel(s.slice(openIdx + 1, closeP), ",")
                    .map((a) => translateTokensTsToLavaScript(a.trim()))
                    .join(", ");
                out += `${fn}(${inner})`;
                i = closeP + 1;
                continue;
            }
        }

        if (isIdentStart(c)) {
            const start = i;
            while (i < s.length && isIdentCont(s[i])) i++;
            const word = s.slice(start, i);
            const isMember = start > 0 && s[start - 1] === ".";

            if (!isMember) {
                if (
                    (word === "String" || word === "Number" || word === "Boolean") &&
                    i < s.length &&
                    s[i] === "("
                ) {
                    const closeP = findMatchingDelim(s, i, "(", ")");
                    if (closeP > i) {
                        const fn =
                            word === "String" ? "str" : word === "Number" ? "num" : "bool";
                        out += `${fn}(${translateTokensTsToLavaScript(s.slice(i + 1, closeP))})`;
                        i = closeP + 1;
                        continue;
                    }
                }
                if (word === "null") {
                    out += "nil";
                    continue;
                }
                if (word === "this") {
                    out += "self";
                    continue;
                }
            }
            out += word;
            continue;
        }

        out += c;
        i++;
    }
    return out;
}

/* -------------------------------------------------------------------------
 * LavaScript -> TypeScript Transpiler
 * ------------------------------------------------------------------------- */

type BlockKind = "normal" | "class" | "interface" | "enum" | "switch" | "case";

interface BlockFrame {
    level: number;
    kind: BlockKind;
}

function splitCommentLavaScript(line: string): { code: string; comment: string | null } {
    let quote = "";
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
            if (c === "\\" && i + 1 < line.length) i++;
            else if (c === quote) quote = "";
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            quote = c;
            continue;
        }
        if (c === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
            return {
                code: line.slice(0, i).trimEnd(),
                comment: line.slice(i + 1),
            };
        }
    }
    return { code: line, comment: null };
}

function emitFunctionHeaderLavaScriptToTs(
    header: string,
    inClass: boolean
): string | null {
    let s = header.trim();
    const prefixes: string[] = [];

    for (;;) {
        let matched = false;
        for (const kw of ["export", "static", "async"]) {
            const rest = startsWithKw(s, kw);
            if (rest !== null) {
                prefixes.push(kw);
                s = rest;
                matched = true;
                break;
            }
        }
        if (!matched) break;
    }

    let rest = startsWithKw(s, "def");
    if (rest === null) rest = startsWithKw(s, "fn");
    if (rest === null) return null;
    s = rest;

    const lparen = s.indexOf("(");
    if (lparen <= 0) return null;
    const rparen = findMatchingDelim(s, lparen, "(", ")");
    if (rparen < 0) return null;

    let rawName = s.slice(0, lparen).trim();
    let generics = "";
    const gIdx = rawName.indexOf("[");
    if (gIdx > 0 && findMatchingDelim(rawName, gIdx, "[", "]") === rawName.length - 1) {
        const gArgs = splitTopLevel(rawName.slice(gIdx + 1, -1), ",")
            .map((a) => translateTypeLavaScriptToTs(a.trim()))
            .join(", ");
        generics = `<${gArgs}>`;
        rawName = rawName.slice(0, gIdx).trim();
    }

    const rawParams = splitTopLevel(s.slice(lparen + 1, rparen), ",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && p !== "self");

    const tsParams = rawParams.map((p) => {
        const eqIdx = findTopLevelToken(p, "=");
        const lhs = eqIdx >= 0 ? p.slice(0, eqIdx).trim() : p;
        const defVal = eqIdx >= 0 ? ` = ${translateTokensLavaScriptToTs(p.slice(eqIdx + 1).trim())}` : "";
        const colonIdx = findTopLevelToken(lhs, ":");
        if (colonIdx > 0) {
            const pName = lhs.slice(0, colonIdx).trim();
            const pType = translateTypeLavaScriptToTs(lhs.slice(colonIdx + 1).trim());
            return `${pName}: ${pType}${defVal}`;
        }
        return `${lhs}${defVal}`;
    });

    const afterRparen = s.slice(rparen + 1).trim();
    let retTs = "";
    if (afterRparen.startsWith("->")) {
        const retLavaScript = afterRparen.slice(2).trim();
        const mappedRet = translateTypeLavaScriptToTs(retLavaScript);
        if (prefixes.includes("async") && !mappedRet.startsWith("Promise<")) {
            retTs = `: Promise<${mappedRet}>`;
        } else {
            retTs = `: ${mappedRet}`;
        }
    }

    if (inClass) {
        if (rawName === "__init__" || rawName === "constructor") {
            return `constructor(${tsParams.join(", ")}) {`;
        }
        const pre = prefixes.length > 0 ? `${prefixes.join(" ")} ` : "";
        return `${pre}${rawName}${generics}(${tsParams.join(", ")})${retTs} {`;
    }

    const pre = prefixes.length > 0 ? `${prefixes.join(" ")} ` : "";
    return `${pre}function ${rawName}${generics}(${tsParams.join(", ")})${retTs} {`;
}

function emitForInLavaScriptToTs(clause: string): string {
    const inIdx = findTopLevelToken(clause, " in ");
    if (inIdx < 0) {
        return `for (${translateTokensLavaScriptToTs(clause)}) {`;
    }
    const rawVar = clause.slice(0, inIdx).trim();
    const vname = rawVar.includes(":") ? rawVar.slice(0, rawVar.indexOf(":")).trim() : rawVar;
    const iter = clause.slice(inIdx + 4).trim();

    if (iter.startsWith("range(") && findMatchingDelim(iter, 5, "(", ")") === iter.length - 1) {
        const args = splitTopLevel(iter.slice(6, -1), ",").map((a) =>
            translateTokensLavaScriptToTs(a.trim())
        );
        if (args.length === 1) {
            return `for (let ${vname} = 0; ${vname} < ${args[0]}; ${vname}++) {`;
        }
        if (args.length === 2) {
            return `for (let ${vname} = ${args[0]}; ${vname} < ${args[1]}; ${vname}++) {`;
        }
        if (args.length === 3) {
            const step = args[2];
            if (step === "-1") {
                return `for (let ${vname} = ${args[0]}; ${vname} > ${args[1]}; ${vname}--) {`;
            }
            if (step.startsWith("-")) {
                return `for (let ${vname} = ${args[0]}; ${vname} > ${args[1]}; ${vname} -= ${step.slice(1).trim()}) {`;
            }
            return `for (let ${vname} = ${args[0]}; ${vname} < ${args[1]}; ${vname} += ${step}) {`;
        }
    }

    return `for (const ${vname} of ${translateTokensLavaScriptToTs(iter)}) {`;
}

export function lavascriptToTs(src: string, tsIndent: string = "    "): string {
    if (src.charCodeAt(0) === 0xfeff) {
        throw new LavaScriptSyntaxError("UTF-8 BOM (U+FEFF) is forbidden at start of file", 1, 1);
    }

    const rawLines = src.split(/\r\n|\r|\n/);
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
        rawLines.pop();
    }

    let indentChar = "";
    let indentWidth = 0;
    const stack: BlockFrame[] = [];
    let currentLevel = 0;
    let prevOpenedBlock = false;
    let prevBlockLine = 0;
    const outLines: string[] = [];

    const closeFrame = (frame: BlockFrame) => {
        if (frame.kind === "case") return;
        outLines.push(`${tsIndent.repeat(frame.level)}}`);
    };

    for (let idx = 0; idx < rawLines.length; idx++) {
        const lineNo = idx + 1;
        const raw = rawLines[idx];

        // Count leading spaces / tabs
        let ws = 0;
        let hasSpace = false;
        let hasTab = false;
        while (ws < raw.length && (raw[ws] === " " || raw[ws] === "\t")) {
            if (raw[ws] === " ") hasSpace = true;
            else hasTab = true;
            ws++;
        }

        // Blank line
        if (ws === raw.length) {
            outLines.push("");
            continue;
        }

        // Check trailing whitespace
        if (raw.endsWith(" ") || raw.endsWith("\t")) {
            throw new LavaScriptSyntaxError(
                "trailing whitespace is forbidden on non-blank lines",
                lineNo,
                raw.length
            );
        }

        if (hasSpace && hasTab) {
            throw new LavaScriptSyntaxError("mixed spaces and tabs in indentation", lineNo, 1);
        }

        let level = 0;
        if (ws > 0) {
            const ch = raw[0];
            if (!indentChar) {
                indentChar = ch;
                indentWidth = ws;
            } else if (ch !== indentChar) {
                throw new LavaScriptSyntaxError("inconsistent indentation character (spaces vs tabs)", lineNo, 1);
            }
            if (ws % indentWidth !== 0) {
                throw new LavaScriptSyntaxError(
                    "indentation is not an exact multiple of the file indent unit",
                    lineNo,
                    1
                );
            }
            level = ws / indentWidth;
        }

        if (prevOpenedBlock) {
            if (level !== currentLevel) {
                throw new LavaScriptSyntaxError("expected indented block after ':' header", lineNo, 1);
            }
            prevOpenedBlock = false;
        } else if (level > currentLevel) {
            throw new LavaScriptSyntaxError("unexpected indentation increase", lineNo, 1);
        }

        const trimmed = raw.slice(ws);
        const { code, comment } = splitCommentLavaScript(trimmed);

        // Full-line comment
        if (!code && comment !== null) {
            outLines.push(`${tsIndent.repeat(level)}//${comment}`);
            continue;
        }

        const isElif = startsWithKw(code, "elif") !== null && code.endsWith(":");
        const isElse = code === "else:";
        const isExcept =
            (startsWithKw(code, "except") !== null || startsWithKw(code, "catch") !== null) &&
            code.endsWith(":");
        const isFinally = code === "finally:";

        // Close blocks that ended before this line
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
            const top = stack[stack.length - 1];
            if (top.level === level && (isElif || isElse || isExcept || isFinally) && top.kind !== "case") {
                break;
            }
            stack.pop();
            closeFrame(top);
        }
        currentLevel = level;

        const commentSuffix = comment !== null ? ` //${comment}` : "";
        const inClass = stack.length > 0 && stack[stack.length - 1].kind === "class";
        const inInterface = stack.length > 0 && stack[stack.length - 1].kind === "interface";
        const inEnum = stack.length > 0 && stack[stack.length - 1].kind === "enum";

        // `pass` no-op placeholder
        if (code === "pass") {
            if (comment !== null) {
                outLines.push(`${tsIndent.repeat(level)}//${comment}`);
            }
            continue;
        }

        // Compound block header ending with `:`
        if (code.endsWith(":")) {
            const header = code.slice(0, -1).trimEnd();
            let kwRest: string | null = null;

            if (isElif && stack.length > 0 && stack[stack.length - 1].level === level) {
                stack.pop();
                const cond = startsWithKw(header, "elif")!;
                outLines.push(
                    `${tsIndent.repeat(level)}} else if (${translateTokensLavaScriptToTs(cond)}) {${commentSuffix}`
                );
                stack.push({ level, kind: "normal" });
                currentLevel = level + 1;
                prevOpenedBlock = true;
                prevBlockLine = lineNo;
                continue;
            }

            if (isElse && stack.length > 0 && stack[stack.length - 1].level === level) {
                stack.pop();
                outLines.push(`${tsIndent.repeat(level)}} else {${commentSuffix}`);
                stack.push({ level, kind: "normal" });
                currentLevel = level + 1;
                prevOpenedBlock = true;
                prevBlockLine = lineNo;
                continue;
            }

            if (isExcept && stack.length > 0 && stack[stack.length - 1].level === level) {
                stack.pop();
                const errVar = (startsWithKw(header, "except") ?? startsWithKw(header, "catch") ?? "").trim();
                const catchClause = errVar ? ` (${errVar})` : "";
                outLines.push(`${tsIndent.repeat(level)}} catch${catchClause} {${commentSuffix}`);
                stack.push({ level, kind: "normal" });
                currentLevel = level + 1;
                prevOpenedBlock = true;
                prevBlockLine = lineNo;
                continue;
            }

            if (isFinally && stack.length > 0 && stack[stack.length - 1].level === level) {
                stack.pop();
                outLines.push(`${tsIndent.repeat(level)}} finally {${commentSuffix}`);
                stack.push({ level, kind: "normal" });
                currentLevel = level + 1;
                prevOpenedBlock = true;
                prevBlockLine = lineNo;
                continue;
            }

            if ((kwRest = startsWithKw(header, "if")) !== null) {
                outLines.push(
                    `${tsIndent.repeat(level)}if (${translateTokensLavaScriptToTs(kwRest)}) {${commentSuffix}`
                );
                stack.push({ level, kind: "normal" });
            } else if ((kwRest = startsWithKw(header, "while")) !== null) {
                outLines.push(
                    `${tsIndent.repeat(level)}while (${translateTokensLavaScriptToTs(kwRest)}) {${commentSuffix}`
                );
                stack.push({ level, kind: "normal" });
            } else if ((kwRest = startsWithKw(header, "for")) !== null) {
                outLines.push(`${tsIndent.repeat(level)}${emitForInLavaScriptToTs(kwRest)}${commentSuffix}`);
                stack.push({ level, kind: "normal" });
            } else if (
                (kwRest = startsWithKw(header, "switch")) !== null ||
                (kwRest = startsWithKw(header, "match")) !== null
            ) {
                outLines.push(
                    `${tsIndent.repeat(level)}switch (${translateTokensLavaScriptToTs(kwRest)}) {${commentSuffix}`
                );
                stack.push({ level, kind: "switch" });
            } else if ((kwRest = startsWithKw(header, "case")) !== null) {
                outLines.push(
                    `${tsIndent.repeat(level)}case ${translateTokensLavaScriptToTs(kwRest)}:${commentSuffix}`
                );
                stack.push({ level, kind: "case" });
            } else if (header === "default") {
                outLines.push(`${tsIndent.repeat(level)}default:${commentSuffix}`);
                stack.push({ level, kind: "case" });
            } else if (header === "try") {
                outLines.push(`${tsIndent.repeat(level)}try {${commentSuffix}`);
                stack.push({ level, kind: "normal" });
            } else {
                const fnTs = emitFunctionHeaderLavaScriptToTs(header, inClass);
                if (fnTs !== null) {
                    outLines.push(`${tsIndent.repeat(level)}${fnTs}${commentSuffix}`);
                    stack.push({ level, kind: "normal" });
                } else {
                    // Check `class`, `interface`, `enum` (with optional `export `)
                    let h = header;
                    let exp = "";
                    const expRest = startsWithKw(h, "export");
                    if (expRest !== null) {
                        exp = "export ";
                        h = expRest;
                    }

                    if ((kwRest = startsWithKw(h, "class")) !== null || (kwRest = startsWithKw(h, "interface")) !== null) {
                        const isCls = startsWithKw(h, "class") !== null;
                        const kindWord = isCls ? "class" : "interface";
                        const lp = kwRest.indexOf("(");
                        let declHead = kwRest;
                        let ext = "";
                        if (lp > 0 && findMatchingDelim(kwRest, lp, "(", ")") === kwRest.length - 1) {
                            declHead = kwRest.slice(0, lp).trim();
                            ext = ` extends ${translateTypeLavaScriptToTs(kwRest.slice(lp + 1, -1).trim())}`;
                        }
                        outLines.push(
                            `${tsIndent.repeat(level)}${exp}${kindWord} ${translateTypeLavaScriptToTs(declHead)}${ext} {${commentSuffix}`
                        );
                        stack.push({ level, kind: isCls ? "class" : "interface" });
                    } else if ((kwRest = startsWithKw(h, "enum")) !== null) {
                        outLines.push(`${tsIndent.repeat(level)}${exp}enum ${kwRest.trim()} {${commentSuffix}`);
                        stack.push({ level, kind: "enum" });
                    } else {
                        outLines.push(
                            `${tsIndent.repeat(level)}${translateTokensLavaScriptToTs(header)} {${commentSuffix}`
                        );
                        stack.push({ level, kind: "normal" });
                    }
                }
            }

            currentLevel = level + 1;
            prevOpenedBlock = true;
            prevBlockLine = lineNo;
            continue;
        }

        // Inside `enum`: `OK = 0` or `Circle` -> `OK = 0,` / `Circle,`
        if (inEnum) {
            const clean = code.endsWith(",") ? code.slice(0, -1).trimEnd() : code;
            outLines.push(`${tsIndent.repeat(level)}${translateTokensLavaScriptToTs(clean)},${commentSuffix}`);
            continue;
        }

        // Module imports:
        //   `from "pkg" import a, b` -> `import { a, b } from "pkg";`
        //   `from "pkg" import * as ns` -> `import * as ns from "pkg";`
        const fromRest = startsWithKw(code, "from");
        if (fromRest !== null) {
            const impIdx = findTopLevelToken(fromRest, " import ");
            if (impIdx > 0) {
                const modSpec = fromRest.slice(0, impIdx).trim();
                const items = fromRest.slice(impIdx + 8).trim();
                const quotedMod =
                    modSpec.startsWith('"') || modSpec.startsWith("'") ? modSpec : `"${modSpec}"`;
                if (items.startsWith("*")) {
                    outLines.push(`${tsIndent.repeat(level)}import ${items} from ${quotedMod};${commentSuffix}`);
                } else {
                    outLines.push(
                        `${tsIndent.repeat(level)}import { ${items} } from ${quotedMod};${commentSuffix}`
                    );
                }
                continue;
            }
        }

        const impRest = startsWithKw(code, "import");
        if (impRest !== null) {
            outLines.push(`${tsIndent.repeat(level)}import ${impRest};${commentSuffix}`);
            continue;
        }

        // `[export] type Alias = Target`
        let stmt = code;
        let expPrefix = "";
        const expRest = startsWithKw(stmt, "export");
        if (expRest !== null) {
            expPrefix = "export ";
            stmt = expRest;
        }

        const typeRest = startsWithKw(stmt, "type");
        if (typeRest !== null) {
            const eqIdx = findTopLevelToken(typeRest, "=");
            if (eqIdx > 0) {
                const aliasName = translateTypeLavaScriptToTs(typeRest.slice(0, eqIdx).trim());
                const targetType = translateTypeLavaScriptToTs(typeRest.slice(eqIdx + 1).trim());
                outLines.push(
                    `${tsIndent.repeat(level)}${expPrefix}type ${aliasName} = ${targetType};${commentSuffix}`
                );
                continue;
            }
        }

        // Variable or field declaration:
        //   `[export] [var|const|static] name[: Type] [= value]`
        let bindKind: "const" | "let" | "field" = inClass || inInterface ? "field" : "const";
        let declStmt = stmt;
        let staticPrefix = "";

        const staticRest = startsWithKw(declStmt, "static");
        if (staticRest !== null && inClass) {
            staticPrefix = "static ";
            declStmt = staticRest;
        }

        const varRest = startsWithKw(declStmt, "var");
        const mutRest = startsWithKw(declStmt, "mut");
        const constRest = startsWithKw(declStmt, "const");
        const hasExplicitBind = varRest !== null || mutRest !== null || constRest !== null;
        if (varRest !== null || mutRest !== null) {
            bindKind = "let";
            declStmt = (varRest ?? mutRest)!;
        } else if (constRest !== null) {
            bindKind = "const";
            declStmt = constRest;
        }

        const eqIdx = findTopLevelToken(declStmt, "=");
        const isComparison =
            eqIdx >= 0 &&
            (declStmt[eqIdx + 1] === "=" ||
                (eqIdx > 0 &&
                    ["=", "!", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^"].includes(
                        declStmt[eqIdx - 1]
                    )));
        const validEq = isComparison ? -1 : eqIdx;
        const lhsPart = validEq >= 0 ? declStmt.slice(0, validEq).trim() : declStmt.trim();
        const rhsPart = validEq >= 0 ? declStmt.slice(validEq + 1).trim() : null;
        const colonIdx = findTopLevelToken(lhsPart, ":");

        if (colonIdx > 0) {
            const varName = lhsPart.slice(0, colonIdx).trim();
            const rawType = lhsPart.slice(colonIdx + 1).trim();
            if (/^[A-Za-z_$][A-Za-z0-9_$?]*$/.test(varName)) {
                const tsType = translateTypeLavaScriptToTs(rawType);
                let rhsTs = "";
                if (rhsPart !== null) {
                    const comp = tryTranslateComprehensionLavaScriptToTs(rhsPart, rawType);
                    rhsTs = ` = ${comp !== null ? comp : translateTokensLavaScriptToTs(rhsPart)}`;
                }
                if (bindKind === "field") {
                    outLines.push(
                        `${tsIndent.repeat(level)}${staticPrefix}${varName}: ${tsType}${rhsTs};${commentSuffix}`
                    );
                } else {
                    outLines.push(
                        `${tsIndent.repeat(level)}${expPrefix}${bindKind} ${varName}: ${tsType}${rhsTs};${commentSuffix}`
                    );
                }
                continue;
            }
        } else if (
            rhsPart !== null &&
            /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(lhsPart) &&
            (hasExplicitBind || level === 0)
        ) {
            const comp = tryTranslateComprehensionLavaScriptToTs(rhsPart);
            const rhsTs = comp !== null ? comp : translateTokensLavaScriptToTs(rhsPart);
            const kw = bindKind === "field" ? "" : `${bindKind} `;
            outLines.push(
                `${tsIndent.repeat(level)}${expPrefix}${staticPrefix}${kw}${lhsPart} = ${rhsTs};${commentSuffix}`
            );
            continue;
        }

        // Standard statement / expression
        const translated = translateTokensLavaScriptToTs(code);
        const semi = translated.endsWith(";") || translated.endsWith(",") ? "" : ";";
        outLines.push(`${tsIndent.repeat(level)}${translated}${semi}${commentSuffix}`);
    }

    if (prevOpenedBlock) {
        throw new LavaScriptSyntaxError(
            "dangling block header at end of file (expected indented block)",
            prevBlockLine,
            1
        );
    }

    while (stack.length > 0) {
        closeFrame(stack.pop()!);
    }

    return outLines.join("\n") + "\n";
}

/* -------------------------------------------------------------------------
 * TypeScript -> LavaScript Reverse Transpiler & Canonical Formatter
 * ------------------------------------------------------------------------- */

function splitCommentTs(line: string): { code: string; comment: string | null } {
    let quote = "";
    for (let i = 0; i + 1 < line.length; i++) {
        const c = line[i];
        if (quote) {
            if (c === "\\" && i + 1 < line.length) i++;
            else if (c === quote) quote = "";
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            quote = c;
            continue;
        }
        if (c === "/" && line[i + 1] === "/") {
            return {
                code: line.slice(0, i).trimEnd(),
                comment: line.slice(i + 2),
            };
        }
    }
    return { code: line, comment: null };
}

function tryEmitTsFuncToLavaScript(header: string, inClass: boolean): string | null {
    let s = header.trim();
    const prefixes: string[] = [];

    for (;;) {
        let matched = false;
        for (const kw of ["export", "static", "async"]) {
            const rest = startsWithKw(s, kw);
            if (rest !== null) {
                prefixes.push(kw);
                s = rest;
                matched = true;
                break;
            }
        }
        if (!matched) break;
    }

    let isExplicitFn = false;
    const fnRest = startsWithKw(s, "function");
    if (fnRest !== null) {
        isExplicitFn = true;
        s = fnRest;
    } else if (!inClass) {
        return null;
    }

    // Exclude control keywords inside class check
    for (const kw of ["if", "for", "while", "switch", "catch", "class", "interface", "enum"]) {
        if (startsWithKw(s, kw) !== null) return null;
    }

    const lparen = s.indexOf("(");
    if (lparen <= 0) return null;
    const rparen = findMatchingDelim(s, lparen, "(", ")");
    if (rparen < 0) return null;

    let rawName = s.slice(0, lparen).trim();
    let generics = "";
    const gIdx = rawName.indexOf("<");
    if (gIdx > 0 && findMatchingDelim(rawName, gIdx, "<", ">") === rawName.length - 1) {
        const gArgs = splitTopLevel(rawName.slice(gIdx + 1, -1), ",")
            .map((a) => translateTypeTsToLavaScript(a.trim()))
            .join(", ");
        generics = `[${gArgs}]`;
        rawName = rawName.slice(0, gIdx).trim();
    }
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(rawName)) return null;

    const rawParams = splitTopLevel(s.slice(lparen + 1, rparen), ",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

    const lsParams: string[] = [];
    if (inClass && !prefixes.includes("static")) {
        lsParams.push("self");
    }

    for (const p of rawParams) {
        const eqIdx = findTopLevelToken(p, "=");
        const lhs = eqIdx >= 0 ? p.slice(0, eqIdx).trim() : p;
        const defVal = eqIdx >= 0 ? ` = ${translateTokensTsToLavaScript(p.slice(eqIdx + 1).trim())}` : "";
        const colonIdx = findTopLevelToken(lhs, ":");
        if (colonIdx > 0) {
            const pName = lhs.slice(0, colonIdx).trim();
            const pType = translateTypeTsToLavaScript(lhs.slice(colonIdx + 1).trim());
            lsParams.push(`${pName}: ${pType}${defVal}`);
        } else {
            lsParams.push(`${lhs}${defVal}`);
        }
    }

    const afterRparen = s.slice(rparen + 1).trim();
    let retLs = "";
    if (afterRparen.startsWith(":")) {
        let retTs = afterRparen.slice(1).trim();
        if (
            prefixes.includes("async") &&
            retTs.startsWith("Promise<") &&
            findMatchingDelim(retTs, 7, "<", ">") === retTs.length - 1
        ) {
            retTs = retTs.slice(8, -1).trim();
        }
        retLs = ` -> ${translateTypeTsToLavaScript(retTs)}`;
    }

    const lsName = inClass && rawName === "constructor" ? "__init__" : rawName;
    const pre = prefixes.length > 0 ? `${prefixes.join(" ")} ` : "";
    void isExplicitFn;
    return `${pre}def ${lsName}${generics}(${lsParams.join(", ")})${retLs}:`;
}

function tryEmitTsForToLavaScript(cond: string): string {
    // 1. `const x of items` or `let x of items`
    const ofIdx = findTopLevelToken(cond, " of ");
    if (ofIdx > 0) {
        let lhs = cond.slice(0, ofIdx).trim();
        for (const kw of ["const", "let", "var"]) {
            const r = startsWithKw(lhs, kw);
            if (r !== null) {
                lhs = r;
                break;
            }
        }
        const rhs = translateTokensTsToLavaScript(cond.slice(ofIdx + 4).trim());
        return `for ${lhs} in ${rhs}:`;
    }

    // 2. 3-clause `let i = start; i < stop; i++`
    const parts = splitTopLevel(cond, ";", false).map((p) => p.trim());
    if (parts.length === 3) {
        const mInit = /^(?:let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(.+)$/.exec(parts[0]);
        if (mInit) {
            const v = mInit[1];
            const start = translateTokensTsToLavaScript(mInit[2].trim());
            const mCond = new RegExp(`^${v}\\s*([<>])\\s*(.+)$`).exec(parts[1]);
            if (mCond) {
                const cmp = mCond[1];
                const stop = translateTokensTsToLavaScript(mCond[2].trim());
                const stepPart = parts[2];
                if (cmp === "<" && (stepPart === `${v}++` || stepPart === `++${v}`)) {
                    if (start === "0") return `for ${v} in range(${stop}):`;
                    return `for ${v} in range(${start}, ${stop}):`;
                }
                if (cmp === ">" && (stepPart === `${v}--` || stepPart === `--${v}`)) {
                    return `for ${v} in range(${start}, ${stop}, -1):`;
                }
                const mStep = new RegExp(`^${v}\\s*([+-])=\\s*(.+)$`).exec(stepPart);
                if (mStep) {
                    const sign = mStep[1] === "-" ? "-" : "";
                    const stepVal = translateTokensTsToLavaScript(mStep[2].trim());
                    return `for ${v} in range(${start}, ${stop}, ${sign}${stepVal}):`;
                }
            }
        }
    }

    return `for ${translateTokensTsToLavaScript(cond)}:`;
}

export function tsToLavaScript(src: string, indentUnit: string = "    "): string {
    if (!indentUnit || !/^( +|\t+)$/.test(indentUnit)) {
        throw new LavaScriptSyntaxError("invalid indent unit (must be spaces or tabs)", 1, 1);
    }

    const rawLines = src.split(/\r\n|\r|\n/);
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
        rawLines.pop();
    }

    const outLines: string[] = [];
    const blockKinds: ("normal" | "class" | "interface" | "enum" | "switch")[] = [];
    let inCaseBody = false;
    let caseSwitchDepth = 0;

    for (const raw of rawLines) {
        const trimmed = raw.trim();
        if (!trimmed) {
            outLines.push("");
            continue;
        }

        if (trimmed.startsWith("//")) {
            const effDepth = blockKinds.length + (inCaseBody ? 1 : 0);
            outLines.push(`${indentUnit.repeat(effDepth)}#${trimmed.slice(2)}`);
            continue;
        }

        const { code: rawCode, comment } = splitCommentTs(trimmed);
        let code = rawCode;
        const commentSuffix = comment !== null ? ` #${comment}` : "";

        // Handle leading `}` (`}`, `};`, `} else if (...) {`, `} else {`, `} catch (...) {`, `} finally {`)
        if (code.startsWith("}")) {
            if (inCaseBody && blockKinds.length === caseSwitchDepth) {
                inCaseBody = false;
            }
            if (blockKinds.length > 0) blockKinds.pop();

            const rest = code.slice(1).trim();
            if (!rest || rest === ";") {
                continue;
            }
            code = rest;
        }

        // Check `case ...:` or `default:`
        const caseRest = startsWithKw(code, "case");
        if ((caseRest !== null && code.endsWith(":")) || code === "default:") {
            inCaseBody = false;
            const depth = blockKinds.length;
            if (code === "default:") {
                outLines.push(`${indentUnit.repeat(depth)}default:${commentSuffix}`);
            } else {
                const val = caseRest!.slice(0, -1).trim();
                outLines.push(
                    `${indentUnit.repeat(depth)}case ${translateTokensTsToLavaScript(val)}:${commentSuffix}`
                );
            }
            inCaseBody = true;
            caseSwitchDepth = depth;
            continue;
        }

        const effDepth = blockKinds.length + (inCaseBody ? 1 : 0);
        const inClass =
            blockKinds.length > 0 && blockKinds[blockKinds.length - 1] === "class";
        const inEnum =
            blockKinds.length > 0 && blockKinds[blockKinds.length - 1] === "enum";

        // Block-opening line ending with `{`
        if (code.endsWith("{")) {
            const header = code.slice(0, -1).trimEnd();
            let kwRest: string | null = null;

            if ((kwRest = startsWithKw(header, "else if")) !== null) {
                const cond =
                    kwRest.startsWith("(") && findMatchingDelim(kwRest, 0, "(", ")") === kwRest.length - 1
                        ? kwRest.slice(1, -1)
                        : kwRest;
                outLines.push(
                    `${indentUnit.repeat(effDepth)}elif ${translateTokensTsToLavaScript(cond)}:${commentSuffix}`
                );
                blockKinds.push("normal");
                continue;
            }
            if (header === "else") {
                outLines.push(`${indentUnit.repeat(effDepth)}else:${commentSuffix}`);
                blockKinds.push("normal");
                continue;
            }
            if ((kwRest = startsWithKw(header, "catch")) !== null) {
                const errVar =
                    kwRest.startsWith("(") && findMatchingDelim(kwRest, 0, "(", ")") === kwRest.length - 1
                        ? kwRest.slice(1, -1).trim()
                        : kwRest.trim();
                const clause = errVar ? ` ${errVar}` : "";
                outLines.push(`${indentUnit.repeat(effDepth)}except${clause}:${commentSuffix}`);
                blockKinds.push("normal");
                continue;
            }
            if (header === "finally") {
                outLines.push(`${indentUnit.repeat(effDepth)}finally:${commentSuffix}`);
                blockKinds.push("normal");
                continue;
            }
            if ((kwRest = startsWithKw(header, "if")) !== null) {
                const cond =
                    kwRest.startsWith("(") && findMatchingDelim(kwRest, 0, "(", ")") === kwRest.length - 1
                        ? kwRest.slice(1, -1)
                        : kwRest;
                outLines.push(
                    `${indentUnit.repeat(effDepth)}if ${translateTokensTsToLavaScript(cond)}:${commentSuffix}`
                );
                blockKinds.push("normal");
                continue;
            }
            if ((kwRest = startsWithKw(header, "while")) !== null) {
                const cond =
                    kwRest.startsWith("(") && findMatchingDelim(kwRest, 0, "(", ")") === kwRest.length - 1
                        ? kwRest.slice(1, -1)
                        : kwRest;
                outLines.push(
                    `${indentUnit.repeat(effDepth)}while ${translateTokensTsToLavaScript(cond)}:${commentSuffix}`
                );
                blockKinds.push("normal");
                continue;
            }
            if ((kwRest = startsWithKw(header, "for")) !== null) {
                const cond =
                    kwRest.startsWith("(") && findMatchingDelim(kwRest, 0, "(", ")") === kwRest.length - 1
                        ? kwRest.slice(1, -1)
                        : kwRest;
                outLines.push(`${indentUnit.repeat(effDepth)}${tryEmitTsForToLavaScript(cond)}${commentSuffix}`);
                blockKinds.push("normal");
                continue;
            }
            if ((kwRest = startsWithKw(header, "switch")) !== null) {
                const cond =
                    kwRest.startsWith("(") && findMatchingDelim(kwRest, 0, "(", ")") === kwRest.length - 1
                        ? kwRest.slice(1, -1)
                        : kwRest;
                outLines.push(
                    `${indentUnit.repeat(effDepth)}switch ${translateTokensTsToLavaScript(cond)}:${commentSuffix}`
                );
                blockKinds.push("switch");
                continue;
            }
            if (header === "try") {
                outLines.push(`${indentUnit.repeat(effDepth)}try:${commentSuffix}`);
                blockKinds.push("normal");
                continue;
            }

            const fnLs = tryEmitTsFuncToLavaScript(header, inClass);
            if (fnLs !== null) {
                outLines.push(`${indentUnit.repeat(effDepth)}${fnLs}${commentSuffix}`);
                blockKinds.push("normal");
                continue;
            }

            let h = header;
            let exp = "";
            const expRest = startsWithKw(h, "export");
            if (expRest !== null) {
                exp = "export ";
                h = expRest;
            }

            if (
                (kwRest = startsWithKw(h, "class")) !== null ||
                (kwRest = startsWithKw(h, "interface")) !== null
            ) {
                const isCls = startsWithKw(h, "class") !== null;
                const kindWord = isCls ? "class" : "interface";
                const extIdx = findTopLevelToken(kwRest, " extends ");
                if (extIdx > 0) {
                    const namePart = translateTypeTsToLavaScript(kwRest.slice(0, extIdx).trim());
                    const basePart = translateTypeTsToLavaScript(kwRest.slice(extIdx + 9).trim());
                    outLines.push(
                        `${indentUnit.repeat(effDepth)}${exp}${kindWord} ${namePart}(${basePart}):${commentSuffix}`
                    );
                } else {
                    outLines.push(
                        `${indentUnit.repeat(effDepth)}${exp}${kindWord} ${translateTypeTsToLavaScript(kwRest.trim())}:${commentSuffix}`
                    );
                }
                blockKinds.push(isCls ? "class" : "interface");
                continue;
            }

            if ((kwRest = startsWithKw(h, "enum")) !== null) {
                outLines.push(
                    `${indentUnit.repeat(effDepth)}${exp}enum ${kwRest.trim()}:${commentSuffix}`
                );
                blockKinds.push("enum");
                continue;
            }

            outLines.push(
                `${indentUnit.repeat(effDepth)}${translateTokensTsToLavaScript(header)}:${commentSuffix}`
            );
            blockKinds.push("normal");
            continue;
        }

        // Strip trailing `;` (or `,` inside enum)
        if (code.endsWith(";")) {
            code = code.slice(0, -1).trimEnd();
        } else if (inEnum && code.endsWith(",")) {
            code = code.slice(0, -1).trimEnd();
        }

        // `import { a, b } from "pkg"` -> `from "pkg" import a, b`
        const impRest = startsWithKw(code, "import");
        if (impRest !== null) {
            const fromIdx = findTopLevelToken(impRest, " from ");
            if (fromIdx > 0) {
                const clause = impRest.slice(0, fromIdx).trim();
                const modSpec = impRest.slice(fromIdx + 6).trim();
                if (clause.startsWith("{") && clause.endsWith("}")) {
                    const items = clause.slice(1, -1).trim();
                    outLines.push(
                        `${indentUnit.repeat(effDepth)}from ${modSpec} import ${items}${commentSuffix}`
                    );
                    continue;
                }
                if (clause.startsWith("*")) {
                    outLines.push(
                        `${indentUnit.repeat(effDepth)}from ${modSpec} import ${clause}${commentSuffix}`
                    );
                    continue;
                }
            }
            outLines.push(`${indentUnit.repeat(effDepth)}import ${impRest}${commentSuffix}`);
            continue;
        }

        // `[export] type Alias = Target`
        let stmt = code;
        let expPrefix = "";
        const expRest = startsWithKw(stmt, "export");
        if (expRest !== null) {
            expPrefix = "export ";
            stmt = expRest;
        }

        const typeRest = startsWithKw(stmt, "type");
        if (typeRest !== null) {
            const eqIdx = findTopLevelToken(typeRest, "=");
            if (eqIdx > 0) {
                const aliasName = translateTypeTsToLavaScript(typeRest.slice(0, eqIdx).trim());
                const targetType = translateTypeTsToLavaScript(typeRest.slice(eqIdx + 1).trim());
                outLines.push(
                    `${indentUnit.repeat(effDepth)}${expPrefix}type ${aliasName} = ${targetType}${commentSuffix}`
                );
                continue;
            }
        }

        // Variable / field declaration:
        //   `[export] const x: number = 10` -> `[export] x: num = 10`
        //   `[export] let x: number = 10`   -> `[export] var x: num = 10`
        let varPrefix = "";
        let declStmt = stmt;
        const constRest = startsWithKw(declStmt, "const");
        const letRest = startsWithKw(declStmt, "let");
        const varRest = startsWithKw(declStmt, "var");

        if (constRest !== null) {
            declStmt = constRest;
        } else if (letRest !== null || varRest !== null) {
            varPrefix = "var ";
            declStmt = (letRest ?? varRest)!;
        }

        const eqIdx = findTopLevelToken(declStmt, "=");
        const isComparison =
            eqIdx >= 0 &&
            (declStmt[eqIdx + 1] === "=" ||
                (eqIdx > 0 &&
                    ["=", "!", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^"].includes(
                        declStmt[eqIdx - 1]
                    )));
        const validEq = isComparison ? -1 : eqIdx;
        const lhsPart = validEq >= 0 ? declStmt.slice(0, validEq).trim() : declStmt.trim();
        const rhsPart = validEq >= 0 ? declStmt.slice(validEq + 1).trim() : null;
        const colonIdx = findTopLevelToken(lhsPart, ":");

        if (colonIdx > 0) {
            const vName = lhsPart.slice(0, colonIdx).trim();
            const rawType = lhsPart.slice(colonIdx + 1).trim();
            if (/^(?:static\s+)?[A-Za-z_$][A-Za-z0-9_$?]*$/.test(vName)) {
                const lsType = translateTypeTsToLavaScript(rawType);
                const rhsLs =
                    rhsPart !== null ? ` = ${translateTokensTsToLavaScript(rhsPart)}` : "";
                outLines.push(
                    `${indentUnit.repeat(effDepth)}${expPrefix}${varPrefix}${vName}: ${lsType}${rhsLs}${commentSuffix}`
                );
                continue;
            }
        } else if (
            (constRest !== null || letRest !== null || varRest !== null) &&
            rhsPart !== null &&
            /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(lhsPart)
        ) {
            const bindKw =
                varPrefix
                    ? "var "
                    : effDepth > 0
                      ? "const "
                      : "";
            outLines.push(
                `${indentUnit.repeat(effDepth)}${expPrefix}${bindKw}${lhsPart} = ${translateTokensTsToLavaScript(rhsPart)}${commentSuffix}`
            );
            continue;
        }

        outLines.push(
            `${indentUnit.repeat(effDepth)}${translateTokensTsToLavaScript(code)}${commentSuffix}`
        );
    }

    return outLines.join("\n") + "\n";
}

export function formatLavaScript(src: string, indentUnit: string = "    "): string {
    const ts = lavascriptToTs(src);
    return tsToLavaScript(ts, indentUnit);
}

/* -------------------------------------------------------------------------
 * Conformance Tests & Benchmark
 * ------------------------------------------------------------------------- */

function runTests(): number {
    const cases: string[] = [
        // 1. Core functions, interfaces, enums, loops, conditionals
        `# Service node evaluator in LavaScript
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
`,
        // 2. Classes, inheritance, methods, switch/case, try/except/finally, tab indent
        `enum ShapeKind:
\tCircle = 0
\tRectangle = 1
class Counter(BaseCounter):
\tcount: num
\tdef __init__(self, initial: num):
\t\tself.count = initial
\tdef increment(self, delta: num) -> num:
\t\tself.count += delta
\t\treturn self.count
def describe(kind: ShapeKind) -> str:
\tswitch kind:
\t\tcase ShapeKind.Circle:
\t\t\treturn "circle"
\t\tcase ShapeKind.Rectangle:
\t\t\treturn "rect"
\t\tdefault:
\t\t\treturn "unknown"
`,
        // 3. List, Set, and Dict comprehensions (`list[T]`, `set[T]`, `dict[K, V]`, `rec[K, V]`)
        `def demo_comprehensions() -> num:
    squares: list[num] = [x * x for x in range(1, 7) if x % 2 == 0]
    doubled: list[num] = [x * 2 for x in squares if x > 4]
    uniq: set[num] = {x % 4 for x in range(10)}
    lookup: dict[num, num] = {x: x * 10 for x in squares if x > 0}
    record_map: rec[str, num] = {str(x): x * 2 for x in squares if x > 0}
    return doubled.length + uniq.size + lookup.size + record_map["4"]
`,
    ];

    const indents = ["  ", "    ", "\t"];
    let passed = 0;

    for (let i = 0; i < cases.length; i++) {
        for (const unit of indents) {
            const ts1 = lavascriptToTs(cases[i]);
            const ls = tsToLavaScript(ts1, unit);
            const ts2 = lavascriptToTs(ls);
            if (ts1 !== ts2) {
                console.error(
                    `FAIL [case ${i} roundtrip mismatch]\n--- Expected TS ---\n${ts1}--- Got TS ---\n${ts2}`
                );
                return 1;
            }
            passed++;
        }
    }

    // Exact comprehension codegen & roundtrip check
    {
        const compLs = `def demo():
    squares: list[num] = [x * x for x in range(1, 7) if x % 2 == 0]
    uniq: set[num] = {x % 4 for x in range(10)}
    lookup: dict[num, num] = {x: x * 10 for x in squares if x > 0}
    record_map: rec[str, num] = {str(x): x * 2 for x in squares if x > 0}
`;
        const expectedTs = `function demo() {
    const squares: number[] = Array.from({ length: 7 - 1 }, (_, x) => 1 + x).filter(x => x % 2 === 0).map(x => x * x);
    const uniq: Set<number> = new Set(Array.from({ length: 10 }, (_, x) => x).map(x => x % 4));
    const lookup: Map<number, number> = new Map(squares.filter(x => x > 0).map(x => [x, x * 10]));
    const record_map: Record<string, number> = Object.fromEntries(squares.filter(x => x > 0).map(x => [String(x), x * 2]));
}
`;
        const gotTs = lavascriptToTs(compLs);
        if (gotTs !== expectedTs) {
            console.error(
                `FAIL [comprehensions TS output]\n--- Expected ---\n${expectedTs}--- Got ---\n${gotTs}`
            );
            return 1;
        }
        const gotLs = tsToLavaScript(gotTs, "    ");
        if (gotLs !== compLs) {
            console.error(
                `FAIL [comprehensions LavaScript roundtrip]\n--- Expected ---\n${compLs}--- Got ---\n${gotLs}`
            );
            return 1;
        }
        passed++;
    }

    // Universal newlines (\r\n and \r)
    {
        const crlfSrc = "def add(a: num, b: num) -> num:\r\n    return a + b\r";
        const tsOut = lavascriptToTs(crlfSrc);
        const expected = "function add(a: number, b: number): number {\n    return a + b;\n}\n";
        if (tsOut !== expected) {
            console.error(`FAIL [universal_newlines]:\nGot:\n${tsOut}Expected:\n${expected}`);
            return 1;
        }
        passed++;
    }

    // Invalid syntax tests
    const invalidCases = [
        "    x: num = 1\n", // Unexpected root indent
        "def foo():\n    x: num = 1\n  y: num = 2\n", // Inconsistent indent multiple
        "def foo():\n\tx: num = 1\n    y: num = 2\n", // Mixed tab and space lines
        "def foo():\n \tx: num = 1\n", // Mixed space+tab on same line
        "def dangling():\n", // Dangling block header at EOF
        "def dangling():\nx: num = 1\n", // Missing indent after ':'
        "x: num = 1   \n", // Trailing whitespace
    ];

    for (let i = 0; i < invalidCases.length; i++) {
        let failed = false;
        try {
            lavascriptToTs(invalidCases[i]);
        } catch {
            failed = true;
        }
        if (!failed) {
            console.error(`FAIL [invalid ${i} accepted]: ${JSON.stringify(invalidCases[i])}`);
            return 1;
        }
        passed++;
    }

    console.log(`LavaScript: all ${passed} conformance tests passed.`);
    return 0;
}

function runBench(filePath?: string): number {
    let ls4Sample: string;
    if (filePath) {
        ls4Sample = fs.readFileSync(filePath, "utf8");
    } else {
        const chunks: string[] = [
            "interface Node:\n    id: num\n    weight: num\n    active: bool\n    label: str\n\n",
        ];
        for (let i = 0; i < 250; i++) {
            chunks.push(
                `def compute_layer_${i}(n: list[Node], count: num, threshold: num) -> num:\n` +
                    `    var acc: num = 0.0\n` +
                    `    for i in range(count):\n` +
                    `        if n[i].active and n[i].weight > threshold:\n` +
                    `            acc += n[i].weight * 1.25\n` +
                    `        elif not n[i].active or n[i].id == ${i}:\n` +
                    `            acc -= 0.5\n` +
                    `        else:\n` +
                    `            acc += 0.1\n` +
                    `    return acc\n\n`
            );
        }
        ls4Sample = chunks.join("");
    }

    const tsSample = lavascriptToTs(ls4Sample);
    const lsTabSample = tsToLavaScript(tsSample, "\t");

    const ls4Bytes = Buffer.byteLength(ls4Sample, "utf8");
    const lsTabBytes = Buffer.byteLength(lsTabSample, "utf8");
    const tsBytes = Buffer.byteLength(tsSample, "utf8");

    const iterations = 400;
    for (let w = 0; w < 10; w++) {
        lavascriptToTs(ls4Sample);
    }

    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
        lavascriptToTs(ls4Sample);
    }
    const ls4Sec = (performance.now() - t0) / 1000;

    const tTab = performance.now();
    for (let i = 0; i < iterations; i++) {
        lavascriptToTs(lsTabSample);
    }
    const lsTabSec = (performance.now() - tTab) / 1000;

    const tRev = performance.now();
    for (let i = 0; i < iterations; i++) {
        tsToLavaScript(tsSample, "    ");
    }
    const revSec = (performance.now() - tRev) / 1000;

    const pct4 = (100 * (ls4Bytes - tsBytes)) / tsBytes;
    const pctTab = (100 * (lsTabBytes - tsBytes)) / tsBytes;

    console.log(`LavaScript Benchmark (250 functions, ${iterations} iterations):`);
    console.log(`  TS source size          : ${tsBytes} bytes (${(tsBytes / 1024).toFixed(1)} KiB)`);
    console.log(
        `  LavaScript 4-space size : ${ls4Bytes} bytes (${(ls4Bytes / 1024).toFixed(1)} KiB, ${pct4.toFixed(1)}% vs TS)`
    );
    console.log(
        `  LavaScript tab (\\t) size: ${lsTabBytes} bytes (${(lsTabBytes / 1024).toFixed(1)} KiB, ${pctTab.toFixed(1)}% vs TS)`
    );
    console.log(
        `  LavaScript (4-sp) -> TS : ${(iterations / ls4Sec).toFixed(0)} files/s (${((iterations * ls4Bytes) / (1024 * 1024) / ls4Sec).toFixed(1)} MiB/s)`
    );
    console.log(
        `  LavaScript (tab)  -> TS : ${(iterations / lsTabSec).toFixed(0)} files/s (${((iterations * lsTabBytes) / (1024 * 1024) / lsTabSec).toFixed(1)} MiB/s)`
    );
    console.log(
        `  TS -> LavaScript (4-sp) : ${(iterations / revSec).toFixed(0)} files/s (${((iterations * tsBytes) / (1024 * 1024) / revSec).toFixed(1)} MiB/s)`
    );
    return 0;
}

function printUsage(): void {
    console.log(
        "LavaScript — Pythonic TypeScript / JavaScript Transpiler\n\n" +
            "Usage:\n" +
            "  lavascript <file.ls>                  Transpile LavaScript (.ls) to TypeScript on stdout\n" +
            "  lavascript <file.ls> -o <out.ts>      Transpile LavaScript to a TypeScript file\n" +
            "  lavascript --run <file.ls> [args...]  Transpile and execute immediately via Node.js\n" +
            "  lavascript --lavascript <file.ls>     Format/canonicalize LavaScript (default 4 spaces)\n" +
            "  lavascript --from-ts <file.ts>        Convert TypeScript/JavaScript source to LavaScript\n" +
            "  lavascript --indent <N|tab>           Set LavaScript output indentation (1..8 spaces or 'tab')\n" +
            "  lavascript --check <file.ls>          Validate LavaScript syntax and indentation only\n" +
            "  lavascript --test                     Run built-in conformance test suite\n" +
            "  lavascript --bench [file.ls]          Run transpilation speed & size benchmark"
    );
}

function lowerTsForNodeRun(tsCode: string): string {
    const lines = tsCode.split("\n");
    const out: string[] = [];
    let inEnumName: string | null = null;
    let enumIndent = "";
    let nextEnumVal = 0;

    for (const line of lines) {
        if (inEnumName !== null) {
            const trimmed = line.trim();
            if (trimmed === "}") {
                out.push(`${enumIndent}} as const;`);
                out.push(
                    `${enumIndent}type ${inEnumName} = (typeof ${inEnumName})[keyof typeof ${inEnumName}];`
                );
                inEnumName = null;
                continue;
            }
            const m = /^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*=\s*(.+?))?,?(\s*\/\/.*)?$/.exec(
                line
            );
            if (m) {
                const ind = m[1];
                const key = m[2];
                const val = m[3] !== undefined ? m[3].trim() : String(nextEnumVal);
                const cmt = m[4] ?? "";
                const parsed = Number(val);
                if (Number.isInteger(parsed)) nextEnumVal = parsed + 1;
                else nextEnumVal++;
                out.push(`${ind}${key}: ${val},${cmt}`);
                continue;
            }
            out.push(line);
            continue;
        }

        const em = /^(\s*)(export\s+)?enum\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\{(\s*\/\/.*)?$/.exec(
            line
        );
        if (em) {
            enumIndent = em[1];
            const exp = em[2] ?? "";
            inEnumName = em[3];
            const cmt = em[4] ?? "";
            nextEnumVal = 0;
            out.push(`${enumIndent}${exp}const ${inEnumName} = {${cmt}`);
            continue;
        }

        out.push(line);
    }
    return out.join("\n");
}

function main(): number {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
        printUsage();
        return 1;
    }

    let mode: "to_ts" | "to_ls" | "from_ts" | "check" | "run" = "to_ts";
    let indentUnit = "    ";
    let inPath: string | null = null;
    let outPath: string | null = null;
    let runArgs: string[] = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            printUsage();
            return 0;
        } else if (arg === "--test") {
            return runTests();
        } else if (arg === "--bench") {
            return runBench(argv[i + 1]);
        } else if (arg === "--lavascript") {
            mode = "to_ls";
        } else if (arg === "--from-ts" || arg === "--from-js") {
            mode = "from_ts";
        } else if (arg === "--check") {
            mode = "check";
        } else if (arg === "--run") {
            mode = "run";
            if (i + 1 >= argv.length) {
                console.error("lavascript error: --run requires an input .ls file");
                return 1;
            }
            inPath = argv[++i];
            runArgs = argv.slice(i + 1);
            break;
        } else if (arg === "-o") {
            if (i + 1 >= argv.length) {
                console.error("lavascript error: -o requires an output path");
                return 1;
            }
            outPath = argv[++i];
        } else if (arg === "--indent") {
            if (i + 1 >= argv.length) {
                console.error("lavascript error: --indent requires an argument (1..8 or 'tab')");
                return 1;
            }
            const val = argv[++i];
            if (val === "tab" || val === "\\t") {
                indentUnit = "\t";
            } else {
                const n = Number(val);
                if (!Number.isInteger(n) || n < 1 || n > 8) {
                    console.error("lavascript error: --indent must be 1..8 or 'tab'");
                    return 1;
                }
                indentUnit = " ".repeat(n);
            }
        } else if (!arg.startsWith("-")) {
            inPath = arg;
        } else {
            console.error(`lavascript error: unknown option '${arg}'`);
            return 1;
        }
    }

    if (!inPath) {
        console.error("lavascript error: missing input file");
        return 1;
    }

    let src: string;
    try {
        src = fs.readFileSync(inPath, "utf8");
    } catch {
        console.error(`lavascript error: cannot read '${inPath}'`);
        return 1;
    }

    try {
        if (mode === "check") {
            lavascriptToTs(src);
            return 0;
        }

        if (mode === "run") {
            const tsCode = lowerTsForNodeRun(lavascriptToTs(src));
            const tmpFile = path.join(
                os.tmpdir(),
                `lavascript_run_${process.pid}_${Date.now()}.ts`
            );
            fs.writeFileSync(tmpFile, tsCode, "utf8");
            try {
                const res = spawnSync(
                    process.execPath,
                    ["--no-warnings", tmpFile, ...runArgs],
                    { stdio: "inherit" }
                );
                return res.status ?? 1;
            } finally {
                try {
                    fs.unlinkSync(tmpFile);
                } catch {}
            }
        }

        let result: string;
        if (mode === "to_ts") {
            result = lavascriptToTs(src);
        } else if (mode === "to_ls") {
            result = formatLavaScript(src, indentUnit);
        } else {
            result = tsToLavaScript(src, indentUnit);
        }

        if (outPath) {
            fs.writeFileSync(outPath, result, "utf8");
        } else {
            process.stdout.write(result);
        }
        return 0;
    } catch (e) {
        if (e instanceof LavaScriptSyntaxError) {
            console.error(`${inPath}:${e.line}:${e.col}: error: ${e.message}`);
        } else if (e instanceof Error) {
            console.error(`${inPath}: error: ${e.message}`);
        }
        return 1;
    }
}

process.exit(main());
