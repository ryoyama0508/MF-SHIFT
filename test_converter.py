import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from mf_shift_converter import Xlsx,month_for,locate_layout,norm,clean_time_expr,decode_time,Cell,interpret

class ShiftTests(unittest.TestCase):
    def setUp(self):
        self.rule={'通常出勤':'10:00','通常退勤':'19:00','休憩開始':'12:30','休憩終了':'13:30','空欄の扱い':'勤務'}
        self.cfg={'gray_means_off_verified':True,'decimal_hours_verified':True}
    def test_time(self):
        self.assertEqual(decode_time('-18',self.rule,True),['10:00','18:00','12:30','13:30'])
        short=dict(self.rule,休憩開始='',休憩終了='')
        self.assertEqual(decode_time('9-13',short,True)[:2],['09:00','13:00'])
        self.assertEqual(decode_time('11-19',self.rule,True)[:2],['11:00','19:00'])
        self.assertEqual(decode_time('ｰ１７',self.rule,True)[1],'17:00')
        self.assertEqual(decode_time('-17.5',self.rule,True)[1],'17:30')
    def test_color_and_text_priority(self):
        off=Cell('希','#808080',True,True)
        self.assertEqual(interpret(off,self.rule,self.cfg)[0],'非勤務')
        # Actual file contains gray cells with explicit -19: time wins over background.
        worked=Cell('-18','#808080',True,True)
        self.assertEqual(interpret(worked,self.rule,self.cfg)[0],'勤務')
        unknown=Cell('学会','#FFFFFF',False,True)
        self.assertEqual(interpret(unknown,self.rule,self.cfg)[0],'要確認')
    def test_month(self):
        self.assertEqual(month_for('2026.8 '),(2026,8))
        self.assertEqual(month_for('2026.11'),(2026,11))
        self.assertEqual(norm('宮﨑'),norm('宮崎'))
    def test_real_file_optional(self):
        from os import environ
        p=environ.get('REAL_SHIFT_XLSX')
        if not p:self.skipTest('原本ファイルを指定したときだけ実行')
        w=Xlsx(p)
        self.assertEqual(len(w.sheets),26)
        nov=w.read('2026.11')
        self.assertEqual(nov.get('C4').value,'加藤') # Don't include Excel phonetic rubies
        self.assertEqual(locate_layout(nov,(2026,11)),(5,4,30))
        self.assertTrue(nov.get('C6').gray)
        aug=w.read('2026.8 ')
        self.assertEqual(aug.get('T8').value,'-19')
        self.assertTrue(aug.get('T8').gray) # gray but explicit -19 must not be discarded

if __name__=='__main__':unittest.main()
