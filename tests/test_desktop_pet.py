import unittest
import tkinter as tk
from PIL import Image
from desktop_pet import AgendaCat, enable_crisp_dpi
from agenda_pet.pet_window import keyed


class PetIntegration(unittest.TestCase):
    def test_existing_animations_and_agenda_events(self):
        enable_crisp_dpi()
        import ctypes
        user32=ctypes.windll.user32
        user32.GetThreadDpiAwarenessContext.restype=ctypes.c_void_p
        user32.GetAwarenessFromDpiAwarenessContext.argtypes=(ctypes.c_void_p,)
        self.assertEqual(user32.GetAwarenessFromDpiAwarenessContext(user32.GetThreadDpiAwarenessContext()),2)
        root = tk.Tk(); root.withdraw()
        events = []
        try:
            cat = AgendaCat(root, events.append)
            root.update()
            self.assertTrue(cat.clips)
            from types import SimpleNamespace
            for theme, color in [('dark','#252932'),('light','#e8f1f8')]:
                cat.set_theme(theme)
                cat.show_menu(SimpleNamespace(x_root=100,y_root=100)); root.update()
                self.assertEqual(cat.popup.cget('bg'),color)
                self.assertEqual(len(cat.popup.winfo_children()),4)
                cat.popup.winfo_children()[3].invoke()
                self.assertEqual(events.pop(),'open-today')
                self.assertIsNone(cat.popup)
            self.assertEqual(len(cat.frames['跑右']), 8)
            cat.show_bubble('一条语音回复\n' * 30);root.update()
            bubble=cat.bubble
            self.assertAlmostEqual(float(bubble.attributes('-alpha')),.88,places=2)
            body=next(w for w in bubble.winfo_children() if isinstance(w,tk.Text))
            self.assertEqual(body.cget('state'),'disabled')
            self.assertIn('一条语音回复',body.get('1.0','end'))
            self.assertIsNotNone(cat._bubble_follow)
            cat.set_theme('dark');root.update()
            self.assertIsNot(cat.bubble,bubble)
            self.assertAlmostEqual(float(cat.bubble.attributes('-alpha')),.91,places=2)
            dark_body=next(w for w in cat.bubble.winfo_children() if isinstance(w,tk.Text))
            dark_body.yview_moveto(1);root.update()
            self.assertGreater(dark_body.yview()[0],0)
            next(w for w in cat.bubble.winfo_children() if isinstance(w,tk.Button)).invoke()
            self.assertIsNone(cat.bubble)
            cat.close_bubble();self.assertIsNone(cat._bubble_follow)
            # Check the double-click action, without claiming physical mouse input.
            self.assertTrue(cat.bind('<Double-Button-1>'))
            cat.show_chat()
            self.assertEqual(events, ['open-ai'])
            cat._drag_end(None)
            self.assertIsNone(cat._today_click)  # Double-click must not also open Today.
            cat._double_clicked=False
            cat._drag_end(None)
            self.assertIsNotNone(cat._today_click)
            cat.show_today()
            self.assertEqual(events[-1],'open-today')
            cat.dragging=True
            cat._drag_end(None)
            self.assertIsNone(cat._today_click)
            self.assertFalse(root.winfo_viewable())
            cat.command('working'); self.assertEqual(cat.behavior.state, '工作')
            cat.command('done'); self.assertEqual(cat.behavior.state, '庆祝')
            cat.command('idle'); self.assertEqual(cat.behavior.state, '站立')
            cat.menu.invoke(2); self.assertEqual(events[-1], 'disable')
            cat.destroy()
        finally: root.destroy()
        pixels = Image.new('RGBA', (4, 1))
        pixels.putdata([(255, 0, 255, 255), (180, 114, 181, 255), (181, 114, 181, 255), (20, 20, 20, 127)])
        self.assertEqual(list(keyed(pixels).getchannel('A').getdata()), [0, 255, 0, 0])


if __name__ == '__main__': unittest.main()
