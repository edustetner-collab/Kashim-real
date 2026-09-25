/**
 * Recusa o build se alguma rota em `api/` importar arquivo local do projeto.
 *
 * A Vercel empacota cada função de `api/` sozinha: import de `../lib/...` NÃO
 * vai junto e a função quebra ao subir, em silêncio. Foi o que derrubou o cron
 * do Open Finance por dois dias em 23/09 — nenhum erro na tela, nenhum aviso,
 * só os bancos parando de sincronizar. É por isso que `verifyAuthToken` está
 * copiado em toda rota em vez de importado.
 *
 * Dependência de pacote npm (`@supabase/supabase-js`, `resend`) continua valendo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PASTA = 'api';
const IMPORT_LOCAL = /^\s*import\s[^;]*?from\s+['"](\.[^'"]+)['"]/gm;

const problemas = [];
for (const arquivo of readdirSync(PASTA).filter((f) => f.endsWith('.ts'))) {
  const texto = readFileSync(join(PASTA, arquivo), 'utf8');
  for (const achado of texto.matchAll(IMPORT_LOCAL)) {
    problemas.push({ arquivo, alvo: achado[1] });
  }
}

if (problemas.length > 0) {
  console.error('\n❌ Import local dentro de api/ — a Vercel não empacota isso:\n');
  for (const p of problemas) console.error(`   api/${p.arquivo}  →  ${p.alvo}`);
  console.error('\n   Copie a função para dentro do próprio arquivo da rota.');
  console.error('   Ver o comentário em scripts/checar-api.mjs.\n');
  process.exit(1);
}

console.log(`✓ api/: nenhuma rota com import local (${readdirSync(PASTA).filter((f) => f.endsWith('.ts')).length} arquivos)`);
