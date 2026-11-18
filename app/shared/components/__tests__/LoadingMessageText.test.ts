import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoadingMessageText } from '../LoadingMessageText';
import { LOADING_MESSAGES } from '@/app/shared/constants/loadingMessages';

const render = (message: string) => renderToStaticMarkup(createElement(LoadingMessageText, { message }));

describe('LoadingMessageText', () => {
  it('renders a plain message as is', () => {
    expect(render('Casting lots...')).toBe('Casting lots...');
  });

  it('strikes out the corrected deck size', () => {
    expect(render('Building the next ~~100~~ 70 card monstrosity...')).toBe(
      'Building the next <s>100</s> 70 card monstrosity...',
    );
  });

  it('leaves no stray ~~ on screen for any message', () => {
    for (const message of LOADING_MESSAGES) expect(render(message)).not.toContain('~~');
  });
});
