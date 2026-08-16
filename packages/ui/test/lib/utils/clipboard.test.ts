// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard } from '../../../src/lib/utils/clipboard.js';

describe('copyToClipboard', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    document.execCommand = vi.fn().mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (document as any).execCommand;
  });

  it('uses navigator.clipboard.writeText if available', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    const result = await copyToClipboard('test text');

    expect(result).toBe(true);
    expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith('test text');
  });

  it('falls back to document.execCommand if navigator.clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {});

    vi.spyOn(document, 'createElement');
    vi.spyOn(document.body, 'appendChild');
    vi.spyOn(document.body, 'removeChild');

    const result = await copyToClipboard('fallback text');

    expect(result).toBe(true);
    expect(document.createElement).toHaveBeenCalledWith('textarea');
    expect(document.body.appendChild).toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.body.removeChild).toHaveBeenCalled();
  });

  it('falls back to document.execCommand if navigator.clipboard.writeText throws', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    });

    const result = await copyToClipboard('fallback text');

    expect(result).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('returns false and logs error if fallback also fails', async () => {
    vi.stubGlobal('navigator', {});

    const fallbackError = new Error('execCommand failed');
    vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw fallbackError;
    });

    const result = await copyToClipboard('fail text');

    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith('Failed to copy', expect.any(Error), fallbackError);
  });

  it('handles finally block when textArea has no parentNode', async () => {
    vi.stubGlobal('navigator', {});

    const mockTextArea = {
      value: '',
      style: { top: '', left: '', position: '' },
      focus: vi.fn(),
      select: vi.fn(),
      // explicitly make parentNode null to test the branch
      get parentNode() {
        return null;
      },
    } as unknown as HTMLTextAreaElement;

    vi.spyOn(document, 'createElement').mockReturnValue(mockTextArea);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {
      // intentionally don't append to body so parentNode remains null
      return mockTextArea;
    });
    vi.spyOn(document.body, 'removeChild');

    const result = await copyToClipboard('fallback text');

    expect(result).toBe(true);
    // document.body.removeChild should NOT be called because parentNode is null
    expect(document.body.removeChild).not.toHaveBeenCalled();
  });
});
