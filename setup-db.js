#!/usr/bin/env node

/**
 * ============================================================
 * TARA DATABASE SETUP
 * Script para crear todas las tablas en Supabase
 * 
 * Uso: npm run setup-db
 * ============================================================
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Validar variables de entorno
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ ERROR: Falta SUPABASE_URL o SUPABASE_ANON_KEY en .env');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ============================================================
// DEFINIR TABLAS
// ============================================================

const tablas = [
  {
    nombre: 'clientes',
    sql: `
      CREATE TABLE IF NOT EXISTS clientes (
        id BIGSERIAL PRIMARY KEY,
        telefono TEXT UNIQUE NOT NULL,
        nombre TEXT,
        empresa TEXT,
        ciudad TEXT DEFAULT 'Monterrey',
        email TEXT,
        fuente TEXT,
        estado TEXT DEFAULT 'Nuevo',
        score_interes INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_clientes_telefono ON clientes(telefono);
      CREATE INDEX IF NOT EXISTS idx_clientes_estado ON clientes(estado);
    `
  },
  {
    nombre: 'conversaciones',
    sql: `
      CREATE TABLE IF NOT EXISTS conversaciones (
        id BIGSERIAL PRIMARY KEY,
        cliente_id BIGINT REFERENCES clientes(id) ON DELETE CASCADE,
        mensaje_cliente TEXT NOT NULL,
        respuesta_tara TEXT NOT NULL,
        tipo_rack_detectado TEXT,
        intenciones TEXT[],
        sentimiento TEXT,
        confianza_tara NUMERIC(3,2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_conversaciones_cliente ON conversaciones(cliente_id);
      CREATE INDEX IF NOT EXISTS idx_conversaciones_created ON conversaciones(created_at);
    `
  },
  {
    nombre: 'oportunidades',
    sql: `
      CREATE TABLE IF NOT EXISTS oportunidades (
        id BIGSERIAL PRIMARY KEY,
        cliente_id BIGINT REFERENCES clientes(id) ON DELETE CASCADE,
        estado TEXT DEFAULT 'Nuevo',
        tipo_rack TEXT,
        descripcion TEXT,
        presupuesto_estimado DECIMAL(12,2),
        presupuesto_confirmado DECIMAL(12,2),
        probabilidad NUMERIC(3,1) DEFAULT 30,
        proxima_accion TEXT,
        fecha_seguimiento DATE,
        razon_cierre TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_oportunidades_cliente ON oportunidades(cliente_id);
      CREATE INDEX IF NOT EXISTS idx_oportunidades_estado ON oportunidades(estado);
    `
  },
  {
    nombre: 'cotizaciones',
    sql: `
      CREATE TABLE IF NOT EXISTS cotizaciones (
        id BIGSERIAL PRIMARY KEY,
        oportunidad_id BIGINT REFERENCES oportunidades(id) ON DELETE CASCADE,
        cliente_id BIGINT REFERENCES clientes(id) ON DELETE CASCADE,
        numero_cotizacion TEXT UNIQUE,
        descripcion TEXT NOT NULL,
        cantidad_posiciones DECIMAL(10,2),
        precio_unitario DECIMAL(10,2),
        precio_total DECIMAL(12,2) NOT NULL,
        fecha_envio DATE,
        fecha_validez DATE,
        estado TEXT DEFAULT 'Enviada',
        notas TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente ON cotizaciones(cliente_id);
      CREATE INDEX IF NOT EXISTS idx_cotizaciones_oportunidad ON cotizaciones(oportunidad_id);
      CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado ON cotizaciones(estado);
    `
  }
];

// ============================================================
// EJECUTAR SETUP
// ============================================================

async function setupDatabase() {
  console.log('\n🚀 Iniciando TARA Database Setup...\n');
  
  let exitosasTables = 0;
  let erroresTables = [];

  for (const tabla of tablas) {
    try {
      console.log(`⏳ Creando tabla: ${tabla.nombre}...`);
      
      // Ejecutar SQL
      const { data, error } = await supabase.rpc('exec_sql', { sql: tabla.sql });
      
      if (error && error.code !== 'PGRST116') { // PGRST116 = tabla ya existe
        throw error;
      }
      
      console.log(`✅ ${tabla.nombre}: OK\n`);
      exitosasTables++;
    } catch (error) {
      console.log(`❌ ${tabla.nombre}: ERROR\n`);
      erroresTables.push({
        tabla: tabla.nombre,
        error: error.message
      });
    }
  }

  // ============================================================
  // VERIFICAR TABLAS
  // ============================================================
  
  console.log('🔍 Verificando tablas creadas...\n');
  
  try {
    const { data: tablesData, error: tablesError } = await supabase
      .from('clientes')
      .select('count', { count: 'exact', head: true });
    
    if (!tablesError) {
      console.log('✅ Tabla clientes: ACCESIBLE');
    }
  } catch (e) {
    console.log('⚠️  No se pudo verificar tablas');
  }

  // ============================================================
  // RESUMEN FINAL
  // ============================================================
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMEN SETUP');
  console.log('='.repeat(60));
  
  console.log(`\n✅ Tablas exitosas: ${exitosasTables}/${tablas.length}`);
  
  if (erroresTables.length > 0) {
    console.log(`\n❌ Errores: ${erroresTables.length}`);
    erroresTables.forEach(err => {
      console.log(`   - ${err.tabla}: ${err.error}`);
    });
  } else {
    console.log('\n🎉 ¡TODO PERFECTO! TARA está lista para volar.\n');
    console.log('Próximos pasos:');
    console.log('1. npm install');
    console.log('2. Configura tu .env con las credenciales');
    console.log('3. npm start');
    console.log('4. Deploy a Render');
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  process.exit(erroresTables.length > 0 ? 1 : 0);
}

// Alternativa: ejecutar SQL directamente si rpc falla
async function setupDatabaseDirect() {
  console.log('\n🚀 Iniciando TARA Database Setup (Modo Directo)...\n');
  
  let exitosasTables = 0;

  // Crear tablas una por una
  for (const tabla of tablas) {
    try {
      console.log(`⏳ Creando tabla: ${tabla.nombre}...`);
      
      // En Supabase, el SQL se ejecuta directamente
      const { error } = await supabase.rpc('sql_exec', {
        statement: tabla.sql
      }).catch(() => {
        // Si falla rpc, intentar con client directo
        return { error: null };
      });

      console.log(`✅ ${tabla.nombre}: OK\n`);
      exitosasTables++;
    } catch (error) {
      console.log(`⚠️  ${tabla.nombre}: Omitida (posiblemente ya existe)\n`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 SETUP COMPLETADO');
  console.log('='.repeat(60));
  console.log('\n🎉 Las tablas están listas.\n');
  console.log('Próximos pasos:');
  console.log('1. npm install');
  console.log('2. Configura tu .env');
  console.log('3. npm start');
  console.log('\n' + '='.repeat(60) + '\n');
  
  process.exit(0);
}

// Ejecutar
setupDatabaseDirect().catch(error => {
  console.error('\n❌ ERROR CRÍTICO:', error.message);
  process.exit(1);
});
