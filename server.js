/* POS Plasita – servidor (Node.js 22.5+, sin dependencias externas). Uso: npm start */
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const PORT = process.env.PORT || 3000, ROOT = __dirname;
fs.mkdirSync(path.join(ROOT, "database"), { recursive: true });
const db = new DatabaseSync(path.join(ROOT, "database", "plasita.db"));
db.exec(fs.readFileSync(path.join(ROOT, "database", "schema.sql"), "utf8"));

/* ---- datos iniciales ---- */
const hash = (p, salt) => crypto.scryptSync(p, salt, 32).toString("hex");
if (!db.prepare("SELECT 1 FROM usuarios").get()) {
  for (const [u, n, r, p] of [["admin", "Administrador", "Administrador", "admin123"], ["dylan", "Dylan Chanco", "Cajero", "1234"]]) {
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare("INSERT INTO usuarios (usuario,nombre,rol,salt,hash) VALUES (?,?,?,?,?)").run(u, n, r, salt, hash(p, salt));
  }
  for (const c of ["Caja 1", "Caja 2", "Caja 3"]) db.prepare("INSERT INTO cajas (nombre) VALUES (?)").run(c);
  [["PEL-005","Peluche",5,"Juguetes",48],["LLA-006","Llavero",2.5,"Accesorios",36],["TZA-001","Taza",3.5,"Hogar",40],["LAM-007","Lámpara",9,"Hogar",12],["CAR-008","Cartuchera",10,"Papelería",25],["ORG-002","Organizador de cables",2,"Hogar",60],["ESP-009","Espejo",4.5,"Hogar",18],["CAR-004","Cargador de teléfono",15,"Electrónica",30],["LUC-003","Luces led",10,"Electrónica",22]]
    .forEach(([c, n, p, cat, s]) => db.prepare("INSERT INTO productos (codigo,nombre,precio,categoria,stock) VALUES (?,?,?,?,?)").run(c, n, p, cat, s));
}

/* ---- utilidades ---- */
const sessions = new Map();
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((ok, no) => { let b = ""; req.on("data", c => { b += c; if (b.length > 1e6) { no(new Error("grande")); req.destroy(); } }); req.on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch { no(new Error("JSON inválido")); } }); });
const r2 = n => Math.round(n * 100) / 100;
const prodOut = p => ({ code: p.codigo, name: p.nombre, price: p.precio, cat: p.categoria, stock: p.stock });
const tx = fn => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };

/* ---- API ---- */
async function api(req, res, url) {
  const m = req.method, p = url.pathname;
  if (m === "GET" && p === "/api/ping") return send(res, 200, { ok: true });
  if (m === "POST" && p === "/api/login") {
    const { user, pass, caja } = await readBody(req);
    const u = db.prepare("SELECT * FROM usuarios WHERE lower(usuario)=lower(?)").get(String(user || ""));
    const okPass = u && crypto.timingSafeEqual(Buffer.from(hash(String(pass || ""), u.salt), "hex"), Buffer.from(u.hash, "hex"));
    if (!okPass) return send(res, 401, { error: "Credenciales incorrectas. Verifica tu usuario y contraseña." });
    if (!db.prepare("SELECT 1 FROM cajas WHERE nombre=?").get(String(caja || ""))) return send(res, 400, { error: "Caja no válida." });
    const token = crypto.randomUUID(); sessions.set(token, { usuario: u.usuario, nombre: u.nombre, rol: u.rol });
    return send(res, 200, { nombre: u.nombre, rol: u.rol, caja, token });
  }
  const ses = sessions.get((req.headers.authorization || "").replace("Bearer ", ""));
  if (!ses) return send(res, 401, { error: "Sesión no válida. Inicia sesión nuevamente." });

  if (m === "GET" && p === "/api/productos") return send(res, 200, db.prepare("SELECT * FROM productos WHERE activo=1 ORDER BY nombre").all().map(prodOut));
  let mt;
  if (m === "PATCH" && (mt = p.match(/^\/api\/productos\/([\w-]+)\/stock$/))) {
    if (ses.rol !== "Administrador") return send(res, 403, { error: "Solo el Administrador puede editar el stock." });
    const { stock } = await readBody(req);
    if (!Number.isInteger(stock) || stock < 0) return send(res, 400, { error: "Stock inválido." });
    db.prepare("UPDATE productos SET stock=? WHERE codigo=?").run(stock, mt[1]); return send(res, 200, { ok: true });
  }
  if (m === "POST" && p === "/api/ventas") {
    const v = await readBody(req);
    if (!v.id || !Array.isArray(v.items) || !v.items.length || !["Efectivo", "Yape", "Plin"].includes(v.metodo)) return send(res, 400, { error: "Venta inválida." });
    if (db.prepare("SELECT 1 FROM ventas WHERE id=?").get(v.id)) return send(res, 200, { ok: true, duplicado: true });
    try {
      tx(() => {
        let total = 0, unidades = 0; const lineas = [];
        for (const it of v.items) {
          const pr = db.prepare("SELECT * FROM productos WHERE codigo=?").get(String(it.code)), q = Number(it.qty);
          if (!pr || !Number.isInteger(q) || q < 1) throw Object.assign(new Error("Producto no encontrado: " + it.code), { http: 400 });
          if (pr.stock < q) throw Object.assign(new Error("Stock insuficiente: " + pr.nombre), { http: 409 });
          lineas.push([pr, q]); total += pr.precio * q; unidades += q;
        }
        total = r2(total); const rec = v.metodo === "Efectivo" ? Number(v.recibido) : total;
        if (!(rec >= total)) throw Object.assign(new Error("El dinero recibido es menor al total."), { http: 400 });
        const base = r2(total / 1.18);
        db.prepare("INSERT INTO ventas (id,numero,fecha,hora,caja,usuario,metodo,unidades,total,recibido,vuelto,base,igv) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(v.id, v.n || null, String(v.fecha), String(v.hora), String(v.caja), ses.nombre, v.metodo, unidades, total, rec, r2(rec - total), base, r2(total - base));
        for (const [pr, q] of lineas) {
          db.prepare("INSERT INTO detalle_venta (venta_id,codigo,nombre,precio,cantidad) VALUES (?,?,?,?,?)").run(v.id, pr.codigo, pr.nombre, pr.precio, q);
          db.prepare("UPDATE productos SET stock=stock-? WHERE codigo=?").run(q, pr.codigo);
        }
      });
      return send(res, 200, { ok: true });
    } catch (e) { return send(res, e.http || 500, { error: e.message }); }
  }
  if (m === "GET" && p === "/api/ventas") {
    const f = url.searchParams.get("fecha"), c = url.searchParams.get("caja");
    const rows = db.prepare("SELECT * FROM ventas WHERE (? IS NULL OR fecha=?) AND (? IS NULL OR caja=?) ORDER BY creado").all(f, f, c, c);
    return send(res, 200, rows.map(r => ({ ...r, items: db.prepare("SELECT codigo,nombre,precio,cantidad FROM detalle_venta WHERE venta_id=?").all(r.id) })));
  }
  if (m === "POST" && p === "/api/cierres") {
    const c = await readBody(req);
    db.prepare("INSERT INTO cierres (caja,usuario,fecha,hora,operaciones,total) VALUES (?,?,?,?,?,?)").run(String(c.caja), ses.nombre, String(c.fecha), String(c.hora), +c.operaciones || 0, +c.total || 0);
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: "No encontrado" });
}

/* ---- archivos estáticos (solo html, css y js públicos) ---- */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    let f = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const full = path.join(ROOT, f), ext = path.extname(full);
    const ok = full.startsWith(ROOT + path.sep) && MIME[ext] && f !== "/server.js" && fs.existsSync(full);
    if (!ok) { res.writeHead(404); return res.end("No encontrado"); }
    res.writeHead(200, { "Content-Type": MIME[ext] }); fs.createReadStream(full).pipe(res);
  } catch (e) { send(res, 400, { error: e.message }); }
}).listen(PORT, () => console.log(`POS Plasita en http://localhost:${PORT}`));
