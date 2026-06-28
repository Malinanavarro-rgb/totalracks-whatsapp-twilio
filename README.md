# 🤖 TARA - Bot Inteligente para Total Racks

**Tu especialista virtual disponible 24/7 para generar leads sin freno.**

---

## 📋 Requisitos Previos

- ✅ **Node.js** 18+ (descarga en nodejs.org)
- ✅ **Git** instalado
- ✅ **GitHub** con tu repo
- ✅ **Render.com** cuenta (para deploy)
- ✅ **Twilio** cuenta con WhatsApp Business
- ✅ **Supabase** proyecto creado
- ✅ **OpenAI** API key

---

## 🚀 SETUP EN 5 MINUTOS

### **PASO 1: Clonar el repo o crear estructura local**

```bash
# Opción A: Si ya tienes repo en GitHub
git clone https://github.com/tuusuario/tara-totalracks.git
cd tara-totalracks

# Opción B: Crear desde cero
mkdir tara-totalracks
cd tara-totalracks
git init
```

### **PASO 2: Copiar archivos**

Copia estos archivos a tu carpeta:
- `package.json`
- `server.js`
- `setup-db.js`
- `.env.example` → renombra a `.env`

### **PASO 3: Instalar dependencias**

```bash
npm install
```

### **PASO 4: Configurar `.env`**

Abre `.env` y reemplaza con tus credenciales reales:

```env
# SUPABASE
SUPABASE_URL=https://zstfblqignwbxlcffmzn.supabase.co
SUPABASE_ANON_KEY=eyJhbG... (copia completa)

# TWILIO
TWILIO_ACCOUNT_SID=ACxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_token

# OPENAI
OPENAI_API_KEY=sk-xxxxxxxxxx

# SERVIDOR
PORT=3000
NODE_ENV=development
```

**¿Dónde conseguir cada credencial?**

- **SUPABASE**: https://supabase.com/dashboard/project/[ID]/settings/api
- **TWILIO**: https://console.twilio.com/ (Settings > Account)
- **OPENAI**: https://platform.openai.com/api-keys

### **PASO 5: Crear tablas en Supabase**

```bash
npm run setup-db
```

Verás:
```
🚀 Iniciando TARA Database Setup...
⏳ Creando tabla: clientes...
✅ clientes: OK
...
🎉 ¡TODO PERFECTO!
```

### **PASO 6: Probar localmente**

```bash
npm start
```

Verás:
```
🚀 TARA INICIADO
Servidor escuchando en puerto: 3000
Webhook Twilio: http://localhost:3000/webhook/twilio
```

Abre otra terminal y prueba:

```bash
curl http://localhost:3000/health
```

Debe responder con estado OK.

---

## 📱 Conectar Twilio WhatsApp

### En Twilio Console:

1. Ve a **Messaging > Whatsapp Business**
2. Configura el webhook en **Sandbox Settings**:
   - **URL**: `https://tu-servidor.onrender.com/webhook/twilio`
   - **Método**: POST
   - **Habilitar notificaciones**: ON

3. Prueba enviando un mensaje a tu número de Twilio

---

## 🚀 DEPLOY A RENDER

### **1. Hacer commit en GitHub**

```bash
git add .
git commit -m "feat: TARA setup inicial"
git push origin main
```

### **2. Conectar con Render**

1. Ve a https://render.com y login
2. Click en **New +** > **Web Service**
3. Conecta tu repositorio de GitHub
4. Rellena:
   - **Name**: `tara-totalracks`
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

### **3. Agregar variables de entorno**

En Render > Environment:

```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
OPENAI_API_KEY=...
NODE_ENV=production
```

### **4. Deploy**

Click en **Create Web Service** y espera a que termine. Render te dará una URL como:

```
https://tara-totalracks.onrender.com
```

### **5. Actualizar Twilio**

En Twilio Sandbox Settings, reemplaza el webhook con:

```
https://tara-totalracks.onrender.com/webhook/twilio
```

---

## 📊 Ver tus datos

### **Dashboard en tiempo real**

```bash
curl https://tara-totalracks.onrender.com/api/dashboard
```

Respuesta:
```json
{
  "clientesTotales": 5,
  "oportunidadesAbiertas": 2,
  "pipelineEstimado": 12500,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### **Ver en Supabase**

Ve a https://supabase.com/dashboard y:
1. Selecciona tu proyecto
2. **Editor de tablas** → Selecciona tabla
3. Verás todos los registros en tiempo real

---

## 🛠️ Desarrollo local con auto-reload

Instala nodemon (opcional):

```bash
npm install --save-dev nodemon
npm run dev
```

---

## 🐛 Troubleshooting

### **Error: "Cannot find module '@supabase/supabase-js'"**
```bash
npm install @supabase/supabase-js
```

### **Error: "SUPABASE_URL is not defined"**
- Verifica que `.env` existe en la raíz
- Reinicia el servidor después de cambiar `.env`
- NO commitees `.env` a GitHub (ya está en `.gitignore`)

### **Twilio no recibe mensajes**
- Verifica URL webhook correcta en Twilio Console
- Asegúrate que tu servidor está corriendo (`npm start`)
- Revisa logs en Render: **Logs** tab

### **OpenAI devuelve error 401**
- Verifica API key correcta en `.env`
- La key debe ser `sk-...` completa
- Revisa que tienes saldo en tu cuenta OpenAI

---

## 📈 Crecimiento sin freno

Ahora que TARA está corriendo:

### **Semana 1: Validar funcionamiento**
- [ ] Envía mensaje de prueba a TARA
- [ ] Verifica que se guarda en Supabase
- [ ] Comprueba dashboard en `/api/dashboard`

### **Semana 2: Optimizar mensajes**
- [ ] Edita los prompts en `server.js`
- [ ] Ajusta las preguntas de TARA
- [ ] Entrena el sistema con tus productos

### **Semana 3: Automatización**
- [ ] Conecta Make.com para emails automáticos
- [ ] Crea flujos de seguimiento
- [ ] Integra con tu sistema de facturación

### **Semana 4+: Escalabilidad**
- [ ] Múltiples canales (Instagram, Facebook)
- [ ] Integraciones adicionales
- [ ] Analytics avanzado

---

## 🎯 KPIs a monitorear

**Diarios:**
- Leads nuevos
- Tiempo promedio respuesta
- Mensajes procesados

**Semanales:**
- Conversión (leads → oportunidades)
- Duración en pipeline
- Cotizaciones enviadas

**Mensuales:**
- Ingresos cerrados
- Ticket promedio
- ROI de TARA

---

## 📞 Support

- **Supabase Docs**: https://supabase.com/docs
- **Twilio Docs**: https://www.twilio.com/docs/whatsapp
- **OpenAI Docs**: https://platform.openai.com/docs
- **Render Docs**: https://render.com/docs

---

## 📝 Roadmap

- [ ] Dashboard visual en web
- [ ] Integración con Stripe
- [ ] SMS + WhatsApp simultáneo
- [ ] ML para predicción de cierre
- [ ] API pública para integraciones

---

## 📄 Licencia

MIT - Libre para usar y modificar

---

**¿Preguntas?** Revisa los logs en Render o ejecuta `npm run setup-db` de nuevo.

**¿Listo para crecer?** Haz tu primer commit y deployea ahora mismo. 🚀
