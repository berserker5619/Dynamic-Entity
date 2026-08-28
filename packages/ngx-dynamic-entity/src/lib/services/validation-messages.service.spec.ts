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
});
