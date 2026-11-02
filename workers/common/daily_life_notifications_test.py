from __future__ import annotations
import importlib.util
import json
import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import daily_life_notifications as notifications
from common.notification_time import timezone_for,in_quiet_hours

PREFS={"revision":1,"morningEnabled":False,"morningTime":"08:00","eveningEnabled":False,"eveningTime":"21:00","quietStart":"22:00","quietEnd":"07:00","hydrationRemindersEnabled":False,"includeHealth":False,"includeFilming":True}
class NotificationPreferenceTest(unittest.TestCase):
 def test_requires_complete_explicit_preferences(self):
  self.assertIsNone(notifications.notification_preferences(None))
  self.assertIsNone(notifications.notification_preferences({"morningEnabled":True}))
  self.assertEqual(notifications.notification_preferences(PREFS),PREFS)
  for key,value in [("revision",0),("morningEnabled",1),("quietStart","24:00")]:
   self.assertIsNone(notifications.notification_preferences({**PREFS,key:value}))
 def test_disabled_defaults_schedule_nothing(self):
  local=datetime(2026,11,3,8,0,tzinfo=timezone_for("Asia/Almaty"))
  self.assertEqual(notifications.optional_notification_times(local,PREFS),[])
 def test_two_hydration_slots_stay_outside_cross_midnight_and_daytime_quiet(self):
  for start,end in [("22:00","07:00"),("10:00","18:00"),("00:00","00:00")]:
   local=datetime(2026,11,3,0,0,tzinfo=timezone_for("Asia/Almaty"));prefs={**PREFS,"quietStart":start,"quietEnd":end,"hydrationRemindersEnabled":True}
   values=notifications.optional_notification_times(local,prefs)
   self.assertLessEqual(len(values),2)
   for kind,value in values:
    self.assertTrue(kind.startswith("hydration_"));self.assertFalse(in_quiet_hours(value,start,end,local.tzinfo));self.assertEqual(value.date(),local.date())
 def test_evening_is_generated_only_near_the_actual_time(self):
  prefs={**PREFS,"eveningEnabled":True}
  morning=datetime(2026,11,3,8,0,tzinfo=timezone_for("Asia/Almaty"))
  self.assertEqual(notifications.optional_notification_times(morning,prefs),[])
  self.assertEqual(notifications.optional_notification_times(morning.replace(hour=21),prefs)[0][0],"evening")
  self.assertEqual(notifications.optional_notification_times(morning.replace(hour=22),prefs),[])
 def test_message_limit_counts_utf16_and_retains_plaintext(self):
  result=notifications.clip_message("😀"*4000)
  self.assertEqual(len(result.encode("utf-16-le"))//2,3500)
  self.assertEqual(notifications.clip_message("<b>private title</b>"),"<b>private title</b>")
class BoundedRendererTest(unittest.TestCase):
 def test_short_child_output_succeeds_and_excessive_output_is_killed(self):
  root=Path(__file__).resolve().parents[2]
  valid=notifications._bounded_process([sys.executable,"-c","print('bounded')"],b"{}",{"PATH":os.environ.get("PATH","")},cwd=root,timeout=2)
  self.assertEqual(valid,b"bounded\n")
  self.assertIsNone(notifications._bounded_process([sys.executable,"-c","print('x'*10000)"],b"{}",{"PATH":os.environ.get("PATH","")},cwd=root,timeout=2))
 def test_timeout_kills_an_unresponsive_child(self):
  self.assertIsNone(notifications._bounded_process([sys.executable,"-c","import time;time.sleep(30)"],b"{}",{"PATH":os.environ.get("PATH","")},cwd=Path(__file__).resolve().parents[2],timeout=.1))
 def test_renderer_receives_only_minimal_credentials_no_model_or_bot_keys(self):
  class Settings:
   supabase_url="https://example.supabase.co"
   service_role_key="synthetic-db-key"
  with patch.dict(os.environ,{"GEMINI_API_KEY":"do-not-forward","OPENROUTER_API_KEY":"do-not-forward","TELEGRAM_BOT_TOKEN":"do-not-forward","NODE_OPTIONS":"do-not-forward"}),patch.object(notifications,"_bounded_process",return_value=json.dumps({"ok":True,"text":"Only factual summary"}).encode()) as process:
   self.assertEqual(notifications.render_briefing(Settings(),"owner","2026-11-03","morning",PREFS),"Only factual summary")
  args=process.call_args
  self.assertIn("--max-old-space-size=128",args.args[0])
  self.assertEqual(set(args.args[2]),{"PATH","LANG","NODE_ENV","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"})
  self.assertEqual(json.loads(args.args[1])["includeHealth"],False)
 def test_malformed_output_is_discarded_without_exposing_raw_text(self):
  class Settings:
   supabase_url="https://example.supabase.co"
   service_role_key="test"
  with patch.object(notifications,"_bounded_process",return_value=b'private-invalid-output'):
   self.assertIsNone(notifications.render_briefing(Settings(),"owner","2026-11-03","evening",PREFS))
