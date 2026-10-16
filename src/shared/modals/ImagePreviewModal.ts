import type { ImageAttachment } from '@/core/types';
import { t } from '@/i18n/i18n';

function getFocusableActiveElement(ownerDocument: Document): HTMLElement | null {
  const activeElement = ownerDocument.activeElement;
  if (!activeElement || typeof (activeElement as HTMLElement).focus !== 'function') {
    return null;
  }
  return activeElement as HTMLElement;
}

/**
 * Narrow listener surface shared by the window and document key targets. A union of
 * `Window | Document` loses the typed keydown overloads, so the same KeyboardEvent
 * handler registers and removes on one target with one capture flag.
 */
interface KeyListenerTarget {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void, capture: boolean): void;
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void, capture: boolean): void;
}

/** Owns the DOM and focus lifecycle of one open image preview. */
export class ImagePreviewModal {
  private closeCurrent: (() => void) | null = null;

  open(ownerDocument: Document, image: ImageAttachment): void {
    this.close();

    const previouslyFocusedElement = getFocusableActiveElement(ownerDocument);
    const overlay = ownerDocument.body.createDiv({ cls: 'claudian-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'claudian-image-modal' });
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('chat.images.preview', { name: image.name }));

    modal.createEl('img', {
      attr: {
        src: `data:${image.mediaType};base64,${image.data}`,
        alt: image.name,
      },
    });

    const closeButton = modal.createEl('button', {
      cls: 'claudian-image-modal-close',
      attr: {
        'aria-label': t('chat.images.closePreview'),
        type: 'button',
      },
    });
    closeButton.setText('\u00D7');

    let isClosed = false;
    const close = () => {
      if (isClosed) return;
      isClosed = true;
      keyTarget.removeEventListener('keydown', handleKeyDown, true);
      overlay.remove();
      if (this.closeCurrent === close) {
        this.closeCurrent = null;
      }
      if (previouslyFocusedElement?.isConnected) {
        previouslyFocusedElement.focus();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        closeButton.focus();
      }
    };

    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    // Window capture runs ahead of Obsidian's keymap, whose view scope cancels a running turn on Escape.
    const keyTarget: KeyListenerTarget = ownerDocument.defaultView ?? ownerDocument;
    keyTarget.addEventListener('keydown', handleKeyDown, true);
    this.closeCurrent = close;
    closeButton.focus();
  }

  close(): void {
    this.closeCurrent?.();
  }
}
