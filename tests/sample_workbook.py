"""Generate fictional test inputs; never read a personal timetable or photo."""
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path

from openpyxl import Workbook


def workbook_bytes():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = '日程明细'
    sheet.append(['日期', '课程', '时间', '备注'])
    for offset in range(86):
        sheet.append([(date(2000, 1, 1) + timedelta(days=offset)).isoformat(),
                      '示例课程', '10:25-12:00;13:00-14:00', '虚构测试数据'])
    output = BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


if __name__ == '__main__':
    from PIL import Image
    target = Path(__file__).resolve().parents[1] / '.preview'
    target.mkdir(exist_ok=True)
    (target / 'sample.xlsx').write_bytes(workbook_bytes())
    Image.new('RGB', (40, 40), 'blue').save(target / 'photo.png')
    print('Generated fictional workbook and photo in .preview/')
