# POS Plasita (con base de datos)

## Requisitos
- Node.js 22.5 o superior (https://nodejs.org). No hay que instalar paquetes ni un motor de base de datos aparte.

## Cómo ejecutarlo
1. Abrir una terminal en esta carpeta.
2. `npm start`
3. Abrir http://localhost:3000 en el navegador.

La base de datos (SQLite) se crea sola en `database/plasita.db` con los usuarios, cajas y productos iniciales.
Para reiniciarla, detener el servidor y borrar ese archivo.

Usuarios: admin / admin123 (Administrador) · dylan / 1234 (Cajero)

## Estructura
- server.js: servidor y API (login, productos, ventas, cierres)
- database/schema.sql: tablas (usuarios, cajas, productos, ventas, detalle_venta, cierres)
- index.html, panel.html, ventas.html, ticket, historial, inventario, sync, conflictos, reportes
- js/app.js, css/styles.css: front-end

## Cómo se conecta
Las páginas llaman a la API (`/api/...`); el servidor valida y guarda en SQLite.
- Contraseñas cifradas (scrypt) y sesión por token.
- El precio y el stock se validan en el servidor al registrar la venta; el stock se descuenta en la base de datos.
- Cada venta tiene un identificador único: si se reenvía, no se duplica.
- Modo sin conexión: si el servidor no responde, la venta queda pendiente en el navegador y se envía al sincronizar.
