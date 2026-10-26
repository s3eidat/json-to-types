/* JSON to Types — infer one merged type tree from the sample, then print it in four languages. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;

  // ---------- inference ----------
  function infer(v) {
    if (v === null) return { k: "null" };
    if (Array.isArray(v)) return { k: "array", item: v.map(infer).reduce(merge, { k: "unknown" }) };
    if (typeof v === "object") return { k: "object", fields: Object.keys(v).map(function (key) { return { key: key, type: infer(v[key]), optional: false }; }) };
    if (typeof v === "number") return { k: Number.isInteger(v) ? "int" : "float" };
    if (typeof v === "boolean") return { k: "bool" };
    return { k: "string" };
  }
  function withNull(t) { var c = Object.assign({}, t); if (c.k !== "null") c.nullable = true; return c; }
  function merge(a, b) {
    if (a.k === "unknown") return b;
    if (b.k === "unknown") return a;
    if (a.k === "null") return withNull(b);
    if (b.k === "null") return withNull(a);
    var nullable = !!(a.nullable || b.nullable), r;
    if (a.k === b.k && a.k === "object") {
      var map = {}, fields = a.fields.map(function (f) { var c = { key: f.key, type: f.type, optional: f.optional }; map[f.key] = c; return c; });
      var inB = {};
      b.fields.forEach(function (f) {
        inB[f.key] = true;
        if (map[f.key]) { map[f.key].type = merge(map[f.key].type, f.type); map[f.key].optional = map[f.key].optional || f.optional; }
        else fields.push({ key: f.key, type: f.type, optional: true });
      });
      fields.forEach(function (f) { if (!inB[f.key] && a.fields.some(function (x) { return x.key === f.key; })) f.optional = true; });
      r = { k: "object", fields: fields };
    } else if (a.k === b.k && a.k === "array") r = { k: "array", item: merge(a.item, b.item) };
    else if (a.k === b.k && a.k !== "union") r = { k: a.k };
    else if ((a.k === "int" && b.k === "float") || (a.k === "float" && b.k === "int")) r = { k: "float" };
    else {
      var types = (a.k === "union" ? a.types : [strip(a)]).slice();
      (b.k === "union" ? b.types : [strip(b)]).forEach(function (t) {
        var i = types.findIndex(function (x) { return x.k === t.k || (x.k === "int" && t.k === "float") || (x.k === "float" && t.k === "int"); });
        if (i >= 0) types[i] = merge(types[i], t); else types.push(t);
      });
      r = types.length === 1 ? types[0] : { k: "union", types: types };
    }
    if (nullable) r.nullable = true;
    return r;
  }
  function strip(t) { var c = Object.assign({}, t); delete c.nullable; return c; }

  // ---------- naming ----------
  function words(s) { return String(s).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean); }
  function pascal(s) {
    var p = words(s).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join("");
    if (!p) return "Type";
    return /^\d/.test(p) ? "T" + p : p;
  }
  function singular(s) {
    if (/ies$/i.test(s)) return s.slice(0, -3) + "y";
    if (/(ss|x|ch|sh)es$/i.test(s)) return s.slice(0, -2);
    if (/(us|is|ss)$/i.test(s)) return s; // status, analysis, class
    if (/s$/i.test(s)) return s.slice(0, -1);
    return s;
  }
  function sig(t) {
    var n = t.nullable ? "?" : "";
    if (t.k === "object") return "{" + t.fields.map(function (f) { return JSON.stringify(f.key) + (f.optional ? "?" : "") + ":" + sig(f.type); }).join(",") + "}" + n;
    if (t.k === "array") return "[" + sig(t.item) + "]" + n;
    if (t.k === "union") return "(" + t.types.map(sig).join("|") + ")" + n;
    return t.k + n;
  }
  // Names every object type; identical shapes share one name. pre = parents first, post = dependencies first.
  function nameAll(root, rootName) {
    var used = {}, bySig = {}, pre = [], post = [];
    function unique(n) { var b = n, i = 2; while (used[n]) n = b + i++; used[n] = true; return n; }
    function walk(t, hint) {
      if (t.k === "array") { var s = singular(hint); walk(t.item, s === hint ? hint + "Item" : s); return; }
      if (t.k === "union") { t.types.forEach(function (x) { walk(x, hint); }); return; }
      if (t.k !== "object") return;
      var s2 = sig(strip(t));
      if (bySig[s2]) { t.name = bySig[s2]; return; }
      t.name = bySig[s2] = unique(pascal(hint));
      pre.push(t);
      t.fields.forEach(function (f) { walk(f.type, f.key); });
      post.push(t);
    }
    walk(root, rootName);
    return { pre: pre, post: post };
  }

  // ---------- TypeScript ----------
  var TS_ID = /^[A-Za-z_$][\w$]*$/;
  function tsT(t) {
    var s;
    if (t.k === "array") { var i = tsT(t.item); s = (/[|]/.test(i) ? "(" + i + ")" : i) + "[]"; }
    else if (t.k === "object") s = t.name;
    else if (t.k === "union") s = t.types.map(tsT).join(" | ");
    else s = { string: "string", int: "number", float: "number", bool: "boolean", "null": "null", unknown: "unknown" }[t.k];
    return t.nullable ? s + " | null" : s;
  }
  function toTS(root, names, o) {
    var ex = o.exportKw ? "export " : "", out = [];
    names.pre.forEach(function (t) {
      var body = t.fields.map(function (f) { return "  " + (TS_ID.test(f.key) ? f.key : JSON.stringify(f.key)) + (f.optional ? "?" : "") + ": " + tsT(f.type) + ";"; }).join("\n");
      out.push(o.tsType ? ex + "type " + t.name + " = {\n" + body + (body ? "\n" : "") + "};" : ex + "interface " + t.name + " {\n" + body + (body ? "\n" : "") + "}");
    });
    if (root.k !== "object" || root.nullable) out.unshift(ex + "type " + o.rootName + " = " + tsT(root) + ";");
    return out.join("\n\n") + "\n";
  }

  // ---------- Go ----------
  var INITIALISMS = { ID: 1, URL: 1, URI: 1, API: 1, HTTP: 1, HTTPS: 1, JSON: 1, XML: 1, HTML: 1, UUID: 1, IP: 1, SQL: 1, CPU: 1, DNS: 1, TLS: 1, SSH: 1, UI: 1, UTC: 1 };
  function goName(key) {
    var n = words(key).map(function (w) { var u = w.toUpperCase(); return INITIALISMS[u] ? u : w.charAt(0).toUpperCase() + w.slice(1); }).join("");
    if (!n) n = "Field";
    return /^\d/.test(n) ? "F" + n : n;
  }
  function goT(t, optional) {
    var base;
    if (t.k === "array") return "[]" + goT(t.item, false);
    if (t.k === "object") base = t.name;
    else base = { string: "string", int: "int64", float: "float64", bool: "bool" }[t.k];
    if (!base) return "any"; // null-only, unknown or mixed types
    return t.nullable || optional ? "*" + base : base;
  }
  function pad(s, n) { return s + " ".repeat(Math.max(0, n - s.length)); }
  function toGo(root, names, o) {
    var out = [];
    if (root.k !== "object") out.push("type " + o.rootName + " " + goT(root, false));
    names.pre.forEach(function (t) {
      var seen = {}, rows = t.fields.map(function (f) {
        var n = goName(f.key), b = n, i = 2; while (seen[n]) n = b + i++; seen[n] = true;
        return [n, goT(f.type, f.optional), "`json:\"" + f.key.replace(/["\\]/g, "\\$&") + (f.optional && o.goOmit ? ",omitempty" : "") + "\"`"];
      });
      var w0 = Math.max.apply(null, rows.map(function (r) { return r[0].length; }).concat(0)), w1 = Math.max.apply(null, rows.map(function (r) { return r[1].length; }).concat(0));
      out.push("type " + t.name + " struct {\n" + rows.map(function (r) { return "\t" + pad(r[0], w0) + " " + pad(r[1], w1) + " " + r[2]; }).join("\n") + (rows.length ? "\n" : "") + "}");
    });
    return out.join("\n\n") + "\n";
  }

  // ---------- Python ----------
  var PY_KW = "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" ");
  function pySnake(key) {
    var n = words(key).map(function (w) { return w.toLowerCase(); }).join("_") || "field";
    if (/^\d/.test(n)) n = "f_" + n;
    return PY_KW.indexOf(n) >= 0 ? n + "_" : n;
  }
  function toPy(root, names, o) {
    var used = {};
    function pyT(t) {
      var s;
      if (t.k === "array") { used.List = 1; s = "List[" + pyT(t.item) + "]"; }
      else if (t.k === "object") s = t.name;
      else if (t.k === "union") { used.Union = 1; s = "Union[" + t.types.map(pyT).join(", ") + "]"; }
      else if (t.k === "null") { used.Optional = used.Any = 1; return "Optional[Any]"; }
      else { s = { string: "str", int: "int", float: "float", bool: "bool", unknown: "Any" }[t.k]; if (s === "Any") used.Any = 1; }
      if (t.nullable) { used.Optional = 1; s = "Optional[" + s + "]"; }
      return s;
    }
    var blocks = names.post.map(function (t) {
      var seen = {}, req = [], opt = [];
      t.fields.forEach(function (f) {
        var n = pySnake(f.key), b = n, i = 2; while (seen[n]) n = b + "_" + i++; seen[n] = true;
        var ty = pyT(f.type), note = n !== f.key ? "  # " + JSON.stringify(f.key) : "";
        if (f.optional) { if (!/^Optional\[/.test(ty)) { used.Optional = 1; ty = "Optional[" + ty + "]"; } opt.push("    " + n + ": " + ty + " = None" + note); }
        else req.push("    " + n + ": " + ty + note);
      });
      var body = req.concat(opt);
      return "@dataclass\nclass " + t.name + ":\n" + (body.length ? body.join("\n") : "    pass");
    });
    if (root.k !== "object") blocks.push(o.rootName + " = " + pyT(root));
    var typing = Object.keys(used).sort();
    var head = "from __future__ import annotations\n\nfrom dataclasses import dataclass" + (typing.length ? "\nfrom typing import " + typing.join(", ") : "");
    return head + "\n\n\n" + blocks.join("\n\n\n") + "\n";
  }

  // ---------- Zod ----------
  function zT(t) {
    var s;
    if (t.k === "array") s = "z.array(" + zT(t.item) + ")";
    else if (t.k === "object") s = t.name + "Schema";
    else if (t.k === "union") s = "z.union([" + t.types.map(zT).join(", ") + "])";
    else s = { string: "z.string()", int: "z.number().int()", float: "z.number()", bool: "z.boolean()", "null": "z.null()", unknown: "z.unknown()" }[t.k];
    return t.nullable ? s + ".nullable()" : s;
  }
  function toZod(root, names, o) {
    var ex = o.exportKw ? "export " : "", out = ['import { z } from "zod";'];
    names.post.forEach(function (t) {
      var body = t.fields.map(function (f) { return "  " + (TS_ID.test(f.key) ? f.key : JSON.stringify(f.key)) + ": " + zT(f.type) + (f.optional ? ".optional()" : "") + ","; }).join("\n");
      out.push(ex + "const " + t.name + "Schema = z.object({\n" + body + (body ? "\n" : "") + "});\n" + ex + "type " + t.name + " = z.infer<typeof " + t.name + "Schema>;");
    });
    if (root.k !== "object" || root.nullable) out.push(ex + "const " + o.rootName + "Schema = " + zT(root) + ";\n" + ex + "type " + o.rootName + " = z.infer<typeof " + o.rootName + "Schema>;");
    return out.join("\n\n") + "\n";
  }

  function generate(json, o) {
    var root = infer(json), rn = pascal(o.rootName || "Root");
    o = Object.assign({}, o, { rootName: rn });
    var names = nameAll(root, rn);
    return { root: root, count: names.pre.length, ts: toTS(root, names, o), go: toGo(root, names, o), py: toPy(root, names, o), zod: toZod(root, names, o) };
  }

  // ---------- UI ----------
  var input = $("#input"), out = $("#out"), saved = S3.store("jt.opts") || {};
  var st = { lang: saved.lang || "ts", res: null };
  var EXT = { ts: ".ts", go: ".go", py: ".py", zod: ".ts" };
  $("#root").value = saved.root || "Root";
  if (saved.exportKw === false) $("#export").checked = false;
  $("#tsType").checked = !!saved.tsType;
  if (saved.goOmit === false) $("#goOmit").checked = false;

  function opts() {
    var o = { rootName: $("#root").value.trim() || "Root", exportKw: $("#export").checked, tsType: $("#tsType").checked, goOmit: $("#goOmit").checked };
    S3.store("jt.opts", { root: o.rootName, exportKw: o.exportKw, tsType: o.tsType, goOmit: o.goOmit, lang: st.lang });
    return o;
  }
  function status(cls, t, info) { var s = $("#status"); s.className = "chip " + cls; s.textContent = t; $("#info").textContent = info || ""; }
  function show() {
    $("#ext").textContent = EXT[st.lang];
    out.textContent = st.res ? st.res[st.lang] : "";
    if (!st.res) out.appendChild(S3.h("span", { "class": "faint", text: "Types appear here as soon as the JSON is valid." }));
  }
  function run(user) {
    var t = input.value, o = opts();
    if (!t.trim()) { st.res = null; status("", "Waiting for JSON"); show(); return; }
    var data;
    try { data = JSON.parse(t); } catch (e) { st.res = null; status("bad", "Invalid JSON: " + e.message); show(); return; }
    st.res = generate(data, o);
    status("ok", "✓ Generated", st.res.count + " type" + (st.res.count === 1 ? "" : "s"));
    show();
    if (user) S3.done();
  }
  $$("#lang button").forEach(function (b) {
    b.setAttribute("aria-pressed", String(b.dataset.v === st.lang));
    b.addEventListener("click", function () {
      $$("#lang button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      st.lang = b.dataset.v; opts(); show();
    });
  });
  input.addEventListener("input", S3.debounce(function () { run(false); }, 250));
  $("#root").addEventListener("input", S3.debounce(function () { run(false); }, 200));
  ["#export", "#tsType", "#goOmit"].forEach(function (s) { $(s).addEventListener("change", function () { run(true); }); });
  $("#copy").addEventListener("click", function () { if (st.res) { S3.copy(st.res[st.lang]); S3.done(); } else S3.toast("Nothing to copy yet", "error"); });
  $("#save").addEventListener("click", function () {
    if (!st.res) return;
    var base = st.lang === "zod" ? "schema" : st.lang === "py" ? "models" : "types";
    S3.download(st.res[st.lang], base + EXT[st.lang], "text/plain"); S3.done();
  });
  $("#clear").addEventListener("click", function () { input.value = ""; run(false); input.focus(); });
  $("#open input").addEventListener("change", function (e) {
    var f = e.target.files[0]; if (!f) return;
    S3.readFile(f, "text").then(function (t) { input.value = t; run(true); }); e.target.value = "";
  });
  input.addEventListener("dragover", function (e) { e.preventDefault(); });
  input.addEventListener("drop", function (e) {
    var f = e.dataTransfer.files[0]; if (!f) return;
    e.preventDefault(); S3.readFile(f, "text").then(function (t) { input.value = t; run(true); });
  });
  var SAMPLE = {
    id: 1024, name: "Ada Lovelace", email: "ada@example.org", score: 98.5, verified: true, avatar_url: null,
    address: { street: "12 Analytical Row", city: "London", zip: "N1" },
    roles: ["admin", "editor"],
    orders: [
      { order_id: "A-1", total: 120, items: [{ sku: "BK-1", qty: 2 }] },
      { order_id: "A-2", total: 79.99, items: [], coupon: "AUTUMN" }
    ]
  };
  $("#sample").addEventListener("click", function () { input.value = JSON.stringify(SAMPLE, null, 2); run(true); });

  run(false);

  window.S3_DEMO = function () { $("#sample").click(); };

  window.S3_SELFTEST = function () {
    var src = { id: 1, name: "Ada", score: 9.5, "first-name": "A", tags: ["a"], address: { city: "x", zip: null },
      users: [{ id: 1, email: "a" }, { id: 2, email: null }, { id: 3.5 }], mixed: [1, "a"], home: { city: "y", zip: null } };
    var r = generate(src, { rootName: "root", exportKw: true, tsType: false, goOmit: true });
    var ts = "export interface Root {\n  id: number;\n  name: string;\n  score: number;\n  \"first-name\": string;\n  tags: string[];\n  address: Address;\n  users: User[];\n  mixed: (number | string)[];\n  home: Address;\n}\n\n" +
      "export interface Address {\n  city: string;\n  zip: null;\n}\n\nexport interface User {\n  id: number;\n  email?: string | null;\n}\n";
    if (r.ts !== ts) return "ts:\n" + r.ts;
    if (!/\tID\s+int64\s+`json:"id"`/.test(r.go) || !/\tFirstName\s+string\s+`json:"first-name"`/.test(r.go) || !/\tEmail\s+\*string\s+`json:"email,omitempty"`/.test(r.go) || !/\tID\s+float64\s+`json:"id"`/.test(r.go)) return "go:\n" + r.go;
    if (!/class User:\n    id: float\n    email: Optional\[str\] = None\n/.test(r.py) || !/first_name: str  # "first-name"/.test(r.py) || r.py.indexOf("from typing import Any, List, Optional") < 0) return "py:\n" + r.py;
    if (r.py.indexOf("class Address") > r.py.indexOf("class Root")) return "py order";
    if (r.zod.indexOf("email: z.string().nullable().optional(),") < 0 || r.zod.indexOf("mixed: z.array(z.union([z.number().int(), z.string()])),") < 0 || r.zod.indexOf("UserSchema") > r.zod.indexOf("RootSchema")) return "zod:\n" + r.zod;
    var arr = generate([{ a: 1 }, { b: true }], { rootName: "Root", exportKw: false, goOmit: true });
    if (arr.ts !== "type Root = RootItem[];\n\ninterface RootItem {\n  a?: number;\n  b?: boolean;\n}\n") return "root array:\n" + arr.ts;
    if (arr.go.indexOf("type Root []RootItem") !== 0) return "go root array";
    if (singular("categories") !== "category" || singular("addresses") !== "address" || singular("status") !== "status" || singular("roles") !== "role") return "singular";
    if (goName("avatar_url") !== "AvatarURL" || pySnake("userID") !== "user_id" || pySnake("class") !== "class_") return "names";
    return true;
  };
})();
