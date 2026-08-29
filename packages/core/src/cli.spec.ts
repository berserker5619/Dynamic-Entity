import { runValidateCli, type ValidateCliIo } from './cli';
import type { EntityFormConfig } from './form-model.types';

function io(files: Record<string, string> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const impl: ValidateCliIo = {
    readFile(path) {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path];
    },
    stdout: t => stdout.push(t),
    stderr: t => stderr.push(t),
  };
  return { impl, stdout, stderr };
}

const ok: EntityFormConfig = {
  entity: 'clients',
  version: 1,
  tabs: [
    {
      id: 'main',
      label: { en: 'Main' },
      fields: [{ id: 'name', type: 'text', label: { en: 'Name' } }],
    },
  ],
};

describe('runValidateCli', () => {
  it('prints usage and exits 2 when there are no arguments', () => {
    const { impl, stdout, stderr } = io();
    expect(runValidateCli([], impl)).toBe(2);
    expect(stdout.join('\n')).toContain('Usage: dynamic-entity validate');
    expect(stderr).toEqual([]);
  });

  it('prints usage and exits 0 for --help', () => {
    const { impl, stdout } = io();
    expect(runValidateCli(['--help'], impl)).toBe(0);
    expect(stdout.join('\n')).toContain('--fail-on-warnings');
  });

  it('rejects an unknown command', () => {
    const { impl, stderr } = io();
    expect(runValidateCli(['lint'], impl)).toBe(2);
    expect(stderr.join('\n')).toContain('Unknown command "lint"');
  });

  it('rejects an unknown option', () => {
    const { impl, stderr } = io();
    expect(runValidateCli(['validate', '--quiet', 'c.json'], impl)).toBe(2);
    expect(stderr.join('\n')).toContain('Unknown option "--quiet"');
  });

  it('requires a file path', () => {
    const { impl, stderr } = io();
    expect(runValidateCli(['validate'], impl)).toBe(2);
    expect(stderr.join('\n')).toContain('needs a JSON file path');
  });

  it('rejects a second positional argument', () => {
    const { impl, stderr } = io({ 'a.json': '{}' });
    expect(runValidateCli(['validate', 'a.json', 'b.json'], impl)).toBe(2);
    expect(stderr.join('\n')).toContain('Unexpected extra argument');
  });

  it('exits 2 when the file cannot be read', () => {
    const { impl, stderr } = io();
    expect(runValidateCli(['validate', 'missing.json'], impl)).toBe(2);
    expect(stderr.join('\n')).toContain('Could not read missing.json');
  });

  it('stringifies a non-Error thrown by readFile', () => {
    const { impl, stderr } = io();
    impl.readFile = () => {
      throw 'nope';
    };
    expect(runValidateCli(['validate', 'x.json'], impl)).toBe(2);
    expect(stderr.join('\n')).toContain('nope');
  });

  it('exits 2 when --additional-field-types is followed by another flag', () => {
    const { impl, stderr } = io();
    expect(runValidateCli(['validate', '--additional-field-types', '--fail-on-warnings'], impl)).toBe(
      2,
    );
    expect(stderr.join('\n')).toContain('comma-separated list');
  });

  it('exits 2 when the file is not JSON', () => {
    const { impl, stderr } = io({ 'bad.json': '{ nope' });
    expect(runValidateCli(['validate', 'bad.json'], impl)).toBe(2);
    expect(stderr.join('\n')).toContain('not valid JSON');
  });

  it('exits 0 and is silent for a sound config', () => {
    const { impl, stdout, stderr } = io({ 'ok.json': JSON.stringify(ok) });
    expect(runValidateCli(['validate', 'ok.json'], impl)).toBe(0);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([]);
  });

  it('prints problems and exits 1 for an invalid config', () => {
    const { impl, stdout } = io({ 'bad.json': JSON.stringify({ entity: '', tabs: [] }) });
    expect(runValidateCli(['validate', 'bad.json'], impl)).toBe(1);
    expect(stdout.join('\n')).toContain('[error]');
    expect(stdout.join('\n')).toContain('entity');
  });

  it('rejects a version that is not a positive number', () => {
    const { impl, stdout } = io({ 'v.json': JSON.stringify({ ...ok, version: 0 }) });
    expect(runValidateCli(['validate', 'v.json'], impl)).toBe(1);
    expect(stdout.join('\n')).toContain('positive number');
  });

  it('prints warnings and still exits 0', () => {
    const warned: EntityFormConfig = {
      entity: 'clients',
      tabs: [{ id: 'a', label: {}, fields: [{ id: 'empty-group', type: 'group', label: {} }] }],
    };
    const { impl, stdout } = io({ 'w.json': JSON.stringify(warned) });
    expect(runValidateCli(['validate', 'w.json'], impl)).toBe(0);
    expect(stdout.join('\n')).toContain('[warning]');
    expect(stdout.join('\n')).toContain('renders nothing');
  });

  it('treats warnings as errors when asked', () => {
    const warned: EntityFormConfig = {
      entity: 'clients',
      tabs: [{ id: 'a', label: {}, fields: [{ id: 'empty-group', type: 'group', label: {} }] }],
    };
    const { impl } = io({ 'w.json': JSON.stringify(warned) });
    expect(runValidateCli(['validate', '--fail-on-warnings', 'w.json'], impl)).toBe(1);
  });

  it('accepts a custom type listed after --additional-field-types', () => {
    const custom = {
      ...ok,
      tabs: [{ ...ok.tabs![0], fields: [{ id: 'sig', type: 'signature', label: { en: 'Sig' } }] }],
    };
    const { impl } = io({ 'c.json': JSON.stringify(custom) });
    expect(runValidateCli(['validate', 'c.json'], impl)).toBe(1);
    expect(
      runValidateCli(['validate', '--additional-field-types', 'signature', 'c.json'], impl),
    ).toBe(0);
    expect(
      runValidateCli(['validate', '--additional-field-types=signature', 'c.json'], impl),
    ).toBe(0);
  });

  it('exits 2 when --additional-field-types has no value', () => {
    const { impl, stderr } = io();
    expect(runValidateCli(['validate', '--additional-field-types'], impl)).toBe(2);
    expect(stderr.join('\n')).toContain('comma-separated list');
  });
});
