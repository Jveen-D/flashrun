import { describe, expect, it } from 'vitest';
import {
  extractLocalUrls,
  extractPortConflict,
  formatDisplayUrl,
  formatDuration,
  stripAnsi,
} from '../src/utils/logInsights';

describe('log insights', () => {
  it('strips ANSI escapes and extracts normalized local preview URLs', () => {
    const viteOutput = '  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\r\n'
      + '  ➜  Network: http://0.0.0.0:3000/app, https://[::]:8443/\r\n';
    expect(stripAnsi(viteOutput)).toContain('http://localhost:5173/');

    const urls = extractLocalUrls(viteOutput);
    expect(urls).toEqual([
      'http://localhost:5173/',
      'http://localhost:3000/app',
      'https://localhost:8443/',
    ]);

    // Deduplicates across repeated chunks.
    expect(extractLocalUrls('Ready at http://localhost:5173/', urls)).toEqual(urls);
  });

  it('detects EADDRINUSE and port conflict messages across toolchains', () => {
    expect(extractPortConflict('Error: listen EADDRINUSE: address already in use :::3000')).toBe(3000);
    expect(extractPortConflict('Error: listen \x1b[31mEADDRINUSE\x1b[39m 127.0.0.1:8080')).toBe(8080);
    expect(extractPortConflict('Port 5173 is already in use')).toBe(5173);
    expect(extractPortConflict('bind: address already in use :9090')).toBe(9090);
    expect(extractPortConflict('Server started normally on port 3000')).toBeNull();
  });

  it('formats durations and display URLs concisely', () => {
    expect(formatDuration(450)).toBe('450ms');
    expect(formatDuration(2400)).toBe('2.4s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDisplayUrl('http://localhost:5173/')).toBe('localhost:5173');
    expect(formatDisplayUrl('https://127.0.0.1:8443/api')).toBe('127.0.0.1:8443/api');
  });
});
