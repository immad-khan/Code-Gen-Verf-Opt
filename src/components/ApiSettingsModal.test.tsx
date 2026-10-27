import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApiSettingsModal } from './ApiSettingsModal';

// Mock the testApiKey function
vi.mock('../services/aiService', () => ({
  testApiKey: vi.fn().mockResolvedValue({ ok: true, message: 'API key is valid' }),
}));

const mockSettings = {
  provider: 'openai' as const,
  apiKey: '',
  model: 'gpt-4o-mini',
};

const mockOnClose = vi.fn();
const mockOnSave = vi.fn();

describe('ApiSettingsModal accessibility', () => {
  it('has role="dialog" and aria-modal="true" when open', () => {
    const html = renderToStaticMarkup(
      <ApiSettingsModal
        isOpen={true}
        onClose={mockOnClose}
        settings={mockSettings}
        onSave={mockOnSave}
      />
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it('has a labelled title and description', () => {
    const html = renderToStaticMarkup(
      <ApiSettingsModal
        isOpen={true}
        onClose={mockOnClose}
        settings={mockSettings}
        onSave={mockOnSave}
      />
    );
    expect(html).toContain('id="settings-modal-title"');
    expect(html).toContain('id="settings-modal-description"');
    expect(html).toContain('Connect your AI provider');
    expect(html).toContain('Your API key stays in your browser\'s localStorage');
  });

  it('has an accessible close button with sr-only text', () => {
    const html = renderToStaticMarkup(
      <ApiSettingsModal
        isOpen={true}
        onClose={mockOnClose}
        settings={mockSettings}
        onSave={mockOnSave}
      />
    );
    expect(html).toContain('aria-label="Close settings dialog"');
    expect(html).toContain('sr-only');
  });

  it('provider buttons have role="radio" and aria-checked attributes', () => {
    const html = renderToStaticMarkup(
      <ApiSettingsModal
        isOpen={true}
        onClose={mockOnClose}
        settings={mockSettings}
        onSave={mockOnSave}
      />
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
  });

  it('form inputs have proper labels and descriptions', () => {
    const html = renderToStaticMarkup(
      <ApiSettingsModal
        isOpen={true}
        onClose={mockOnClose}
        settings={mockSettings}
        onSave={mockOnSave}
      />
    );
    expect(html).toContain('for="api-key-input"');
    expect(html).toContain('id="api-key-input"');
    expect(html).toContain('aria-describedby="api-key-description"');
    expect(html).toContain('id="api-key-description"');
  });

  it('model selection has accessible labels', () => {
    const html = renderToStaticMarkup(
      <ApiSettingsModal
        isOpen={true}
        onClose={mockOnClose}
        settings={mockSettings}
        onSave={mockOnSave}
      />
    );
    expect(html).toContain('for="model-select"');
    expect(html).toContain('aria-label="Select model from preset list"');
  });

  it('test button has appropriate aria-labels', () => {
    const html = renderToStaticMarkup(
      <ApiSettingsModal
        isOpen={true}
        onClose={mockOnClose}
        settings={{ ...mockSettings, apiKey: 'test-key-1234567890' }}
        onSave={mockOnSave}
      />
    );
    expect(html).toContain('aria-label="Test API key connection"');
  });

  it('toggle buttons have descriptive aria-labels', () => {
    const html = renderToStaticMarkup(
      <ApiSettingsModal
        isOpen={true}
        onClose={mockOnClose}
        settings={mockSettings}
        onSave={mockOnSave}
      />
    );
    expect(html).toContain('aria-label="Switch to custom model input"');
  });

  it('status area has role="status" and aria-live="polite"', () => {
    const html = renderToStaticMarkup(
      <ApiSettingsModal
        isOpen={true}
        onClose={mockOnClose}
        settings={mockSettings}
        onSave={mockOnSave}
      />
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it('action buttons have descriptive aria-labels', () => {
    const html = renderToStaticMarkup(
      <ApiSettingsModal
        isOpen={true}
        onClose={mockOnClose}
        settings={mockSettings}
        onSave={mockOnSave}
      />
    );
    expect(html).toContain('aria-label="Clear saved API key"');
    expect(html).toContain('aria-label="Cancel and close dialog"');
    expect(html).toContain('aria-label="Save settings and close dialog"');
  });

  it('focus ring utility is applied to focusable elements', () => {
    const html = renderToStaticMarkup(
      <ApiSettingsModal
        isOpen={true}
        onClose={mockOnClose}
        settings={mockSettings}
        onSave={mockOnSave}
      />
    );
    expect(html).toContain('focus-visible:outline-3');
    expect(html).toContain('focus-visible:outline-offset-2');
    expect(html).toContain('focus-visible:outline-[#4338ca]');
  });
});