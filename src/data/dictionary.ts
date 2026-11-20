import type { DictionaryEntry } from '../lib/dictionary';

/** Instant offline entries for a few literary words. */
export const LOCAL_DICTIONARY: Record<string, DictionaryEntry> = {
  supercilious: {
    phonetic: '/ˌsuː.pɚˈsɪl.i.əs/',
    partOfSpeech: 'adjective',
    definition:
      'Behaving or looking as though one thinks one is superior to others; haughtily contemptuous or disdainful.',
    synonyms: ['haughty', 'disdainful', 'condescending', 'patronizing', 'imperious'],
    example:
      'There was nothing remotely supercilious in his demeanor, yet one was invariably left feeling quite humbled.',
  },
  quietude: {
    phonetic: '/ˈkwaɪ.ə.tuːd/',
    partOfSpeech: 'noun',
    definition: 'A state of calmness, peacefulness, or tranquility.',
    synonyms: ['serenity', 'repose', 'tranquility', 'calm', 'peacefulness'],
    example: 'I felt the extraordinary quietude peculiar to this part of the country.',
  },
  salvers: {
    phonetic: '/ˈsæl.vɚz/',
    partOfSpeech: 'noun (plural)',
    definition:
      'Trays, typically made of silver, on which letters, visiting cards, or refreshments are formally presented.',
    synonyms: ['trays', 'platters'],
    example: 'The silent corridors, the polished silver salvers, and the grand library doors.',
  },
  posture: {
    phonetic: '/ˈpɑːs.tʃɚ/',
    partOfSpeech: 'verb',
    definition: 'Behave in a way that is intended to impress or mislead others.',
    synonyms: ['pose', 'strike an attitude', 'dissemble', 'affect'],
    example: 'Greatness is discovered in precisely this refusal to posture.',
  },
};

