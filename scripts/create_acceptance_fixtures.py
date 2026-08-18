from openpyxl import Workbook
from pathlib import Path

out = Path('/home/ubuntu/fieldops-v4-execution/acceptance_fixtures')
out.mkdir(exist_ok=True)

units = Workbook()
ws = units.active
ws.title = 'Units'
ws.append(['اسم الوحدة', 'رمز الوحدة', 'نوع الوحدة', 'الطابق', 'المساحة (م²)'])
ws.append(['Acceptance Unit 20260818', 'QA-ACCEPT-20260818-U01', 'SHELTER', 1, 42])
units.save(out / 'units_fixture.xlsx')

boq = Workbook()
ws = boq.active
ws.title = 'BOQ'
ws.append(['الكود', 'التخصص', 'الوصف', 'الكمية', 'سعر الوحدة', 'وحدة القياس'])
ws.append(['QA-ACCEPT-20260818-B01', 'Civil', 'Acceptance concrete test item', 12, 25, 'm3'])
boq.save(out / 'boq_fixture.xlsx')
