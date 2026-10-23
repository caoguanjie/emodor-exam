import type { CSSProperties } from 'vue';
import type { TemplateSetting } from '../Tiptap/type';

/** Presentation of the controlled paper_layout; no fixed paper width is sent to mobile. */
export function designerSheetStyle(settings: TemplateSetting): CSSProperties {
  const width = settings.pageSize === 'A4' ? '210mm' : '148mm';
  const height = settings.pageSize === 'A4' ? '297mm' : '210mm';
  const pageHeight = settings.pageOrientation === 1 ? height : width;
  return {
    width: settings.pageOrientation === 1 ? width : height,
    minHeight: pageHeight,
    '--designer-page-height': pageHeight,
    paddingTop: `${settings.pageSizeReduce.top}mm`, paddingBottom: `${settings.pageSizeReduce.bottom}mm`,
    paddingLeft: `${settings.pageSizeReduce.left}mm`, paddingRight: `${settings.pageSizeReduce.right}mm`,
  };
}
