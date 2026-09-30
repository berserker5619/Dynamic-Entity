import { TestBed } from '@angular/core/testing';
import { VALIDATION_MESSAGES } from '../tokens/injection-tokens';
import { ValidationMessagesService } from './validation-messages.service';

describe('ValidationMessagesService', () => {
  function make(overrides?: Record<string, unknown>): ValidationMessagesService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: overrides ? [{ provide: VALIDATION_MESSAGES, useValue: overrides }] : [],
    });
    return TestBed.inject(ValidationMessagesService);
  }

  it('returns nothing when there are no errors', () => {
    expect(make().resolve(null, 'en', ['required'])).toBe('');
  });

  it('uses the built-in English default', () => {
    expect(make().resolve({ required: true }, 'en', ['required'])).toBe('This field is required.');
  });

  it('passes the error detail to a parameterised default', () => {
    const msg = make().resolve({ minlength: { requiredLength: 3 } }, 'en', ['minlength']);
    expect(msg).toBe('Minimum 3 characters required.');
  });

  it('honours the caller order, so the most specific message wins', () => {
    const errors = { required: true, pattern: {} };
    expect(make().resolve(errors, 'en', ['pattern', 'required'])).toBe('Invalid format.');
    expect(make().resolve(errors, 'en', ['required', 'pattern'])).toBe('This field is required.');
  });

  it('falls back when no listed key is present', () => {
    expect(make().resolve({ somethingElse: true }, 'en', ['required'])).toBe('Invalid value.');
    expect(make().resolve({ somethingElse: true }, 'en', ['required'], 'invalidNumber')).toBe(
      'Invalid number.',
    );
  });

  /** A dropdown raises the standard `required` error but should read differently. */
  it('maps an error key to a different message key', () => {
    const msg = make().resolve({ required: true }, 'en', [['required', 'requiredSelection']]);
    expect(msg).toBe('Please select an option.');
  });

  it('applies a string override', () => {
    expect(make({ required: 'Pflichtfeld.' }).resolve({ required: true }, 'de', ['required'])).toBe(
      'Pflichtfeld.',
    );
  });

  it('applies a function override, with language and error detail', () => {
    const service = make({
      minlength: (lang: string, err: any) =>
        lang === 'de' ? `Mindestens ${err.requiredLength} Zeichen.` : 'too short',
    });

    expect(service.resolve({ minlength: { requiredLength: 4 } }, 'de', ['minlength'])).toBe(
      'Mindestens 4 Zeichen.',
    );
    expect(service.resolve({ minlength: { requiredLength: 4 } }, 'en', ['minlength'])).toBe(
      'too short',
    );
  });

  it('keeps defaults for keys the consumer did not override', () => {
    const service = make({ required: 'Pflichtfeld.' });

    expect(service.resolve({ required: true }, 'de', ['required'])).toBe('Pflichtfeld.');
    expect(service.resolve({ pattern: {} }, 'de', ['pattern'])).toBe('Invalid format.');
  });

  it('returns an empty string for a key with no default and no override', () => {
    expect(make().messageFor('noSuchKey', 'en', null)).toBe('');
  });

  describe('the newer field types', () => {
    it('counts a tags field in items, although Angular reports minlength and maxlength', () => {
      const service = make();
      expect(service.resolveForField({ minlength: { requiredLength: 2 } }, 'en', 'tags')).toBe('At least 2 required.');
      expect(service.resolveForField({ maxlength: { requiredLength: 5 } }, 'en', 'tags')).toBe(
        'No more than 5 allowed.',
      );
    });

    it('keeps characters for every other type', () => {
      expect(make().resolveForField({ maxlength: { requiredLength: 5 } }, 'en', 'text')).toBe(
        'Maximum 5 characters allowed.',
      );
    });

    it('names the url and phone formats', () => {
      const service = make();
      expect(service.resolveForField({ url: true }, 'en', 'url')).toContain('https://');
      expect(service.resolveForField({ phone: true }, 'en', 'phone')).toBe('Please enter a valid phone number.');
    });

    it('reports a slider or rating out of range like a number', () => {
      const service = make();
      expect(service.resolveForField({ max: { max: 10 } }, 'en', 'slider')).toBe('Value must not exceed 10.');
      expect(service.resolveForField({ min: { min: 3 } }, 'en', 'rating')).toBe('Value must be at least 3.');
    });
  });
});
