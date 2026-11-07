import { describe, expect, it } from 'vitest';
import { cleanPhone, escapeCsvCell, isLidChat, normalizeStages, phoneFromChatId, remapStage } from './crm-logic';

describe('crm-logic', () => {
  it('phoneFromChatId', () => {
    expect(phoneFromChatId('628123@c.us')).toBe('628123');
    expect(phoneFromChatId('628123@s.whatsapp.net')).toBe('628123');
    expect(phoneFromChatId('1234@lid')).toBe(''); // LID = id internal WhatsApp, bukan nomor telepon
    expect(phoneFromChatId('1203-1@g.us')).toBe('');
    expect(phoneFromChatId('weird')).toBe('');
  });
  it('escapeCsvCell', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('x"y')).toBe('"x""y"');
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('-5')).toBe("'-5");
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(12)).toBe('12');
  });
  it('normalizeStages', () => {
    expect(normalizeStages([' A ', 'B'])).toEqual(['A', 'B']);
    expect(normalizeStages(['A'])).toBeNull();
    expect(normalizeStages(['A', 'A'])).toBeNull();
    expect(normalizeStages(['A', ' '])).toBeNull();
    expect(normalizeStages(Array.from({ length: 13 }, (_, i) => 's' + i))).toBeNull();
  });
  it('remapStage', () => {
    expect(remapStage('B', ['A', 'B'])).toBe('B');
    expect(remapStage('Z', ['A', 'B'])).toBe('A');
  });
  it('LID bukan nomor: cleanPhone membuang angka LID yang tersimpan versi lama', () => {
    expect(isLidChat('120852377002179@lid')).toBe(true);
    expect(isLidChat('628123@c.us')).toBe(false);
    expect(cleanPhone('120852377002179@lid', '120852377002179')).toBe('');
    expect(cleanPhone('120852377002179@lid', '+120852377002179')).toBe('');
    expect(cleanPhone('120852377002179@lid', '6285138091836')).toBe('6285138091836'); // nomor asli yang berbeda tetap dipakai
    expect(cleanPhone('628123@c.us', '628123')).toBe('628123');
    expect(cleanPhone('x@lid', undefined)).toBe('');
  });
});
