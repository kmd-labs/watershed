import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { LucideAngularModule, Check, Copy, Map as MapIcon, QrCode, Share2 } from 'lucide-angular';
import { ThemeService } from '@kmd/design-system';
import { I18nService } from '../core/i18n/i18n.service';

/**
 * Share dialog, after kmd-labs/el-nino: QR code (hidden on phones), the app link, and a link to
 * exactly what is on screen now (view, river, presentation step or raindrop), each with a copy
 * button; the system share sheet where the browser offers one.
 */
@Component({
  selector: 'app-share-popup',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './share-popup.component.html',
  styleUrl: './share-popup.component.scss'
})
export class SharePopupComponent implements OnInit {
  readonly i18n = inject(I18nService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly theme = inject(ThemeService);

  /** Link to the current view and state. */
  @Input() viewUrl = '';
  /** The app's start page in the current language. */
  @Input() appUrl = '';
  /** Short description of the current view, shown as a badge. */
  @Input() viewLabel = '';

  readonly copyIcon = Copy;
  readonly checkIcon = Check;
  readonly qrIcon = QrCode;
  readonly viewIcon = MapIcon;
  readonly shareIcon = Share2;

  readonly qrSvg = signal<SafeHtml>('');
  readonly copiedKey = signal<string | null>(null);
  readonly canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit() {
    try {
      // Loaded on demand: the QR library is only needed when the dialog opens.
      const QRCode = (await import('qrcode')).default;
      const svg = await QRCode.toString(this.viewUrl || this.appUrl, {
        type: 'svg',
        margin: 1,
        color: { dark: this.theme.getTokenColor('text-main', '#1e293b'), light: '#ffffff' }
      });
      this.qrSvg.set(this.sanitizer.bypassSecurityTrustHtml(svg));
    } catch (err) {
      console.warn('QR code generation failed:', err);
    }
  }

  async copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.copiedKey.set(key);
      if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedKey.set(null), 2000);
    } catch {
      // Clipboard blocked (permissions / insecure context): the field stays selectable.
    }
  }

  async nativeShare() {
    try {
      await navigator.share({ title: this.i18n.t().docTitle, url: this.viewUrl });
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') this.copyText(this.viewUrl, 'view');
    }
  }
}
