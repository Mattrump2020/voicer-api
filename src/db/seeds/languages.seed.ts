/**
 * Seed file — run once after migration:
 *   npm run db:seed
 */
import { db, languages } from '../index';
import logger from '../../utils/logger';

const LANGUAGES = [
  { name: 'English',          code: 'en'  },
  { name: 'Yoruba',           code: 'yo'  },
  { name: 'Hausa',            code: 'ha'  },
  { name: 'Igbo',             code: 'ig'  },
  { name: 'Nigerian Pidgin',  code: 'pcm' },
  { name: 'French',           code: 'fr'  },
  { name: 'Arabic',           code: 'ar'  },
  { name: 'Swahili',          code: 'sw'  },
  { name: 'Amharic',          code: 'am'  },
  { name: 'Zulu',             code: 'zu'  },
];

async function seed() {
  logger.info('Seeding languages...');

  for (const lang of LANGUAGES) {
    await db.insert(languages)
      .values(lang)
      .onConflictDoNothing(); // safe to re-run
  }

  logger.info(`✅ Seeded ${LANGUAGES.length} languages`);
  process.exit(0);
}

seed().catch((err) => {
  logger.error('Seed failed', { err });
  process.exit(1);
});
