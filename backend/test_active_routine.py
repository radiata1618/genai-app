import unittest
from unittest.mock import MagicMock, patch
import sys
import os
from datetime import date

# backendをPATHに追加
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# 依存モジュールのモック化
sys.modules['firebase_admin'] = MagicMock()
sys.modules['firebase_admin.firestore'] = MagicMock()

from routers import tasks

class TestActiveRoutine(unittest.TestCase):
    def setUp(self):
        self.mock_db = MagicMock()
        self.mock_batch = MagicMock()
        self.mock_db.batch.return_value = self.mock_batch
        
    @patch('routers.tasks.BatchProcessor')
    def test_generate_daily_skips_inactive(self, mock_batch_processor_cls):
        # BatchProcessor のモック
        mock_processor = MagicMock()
        mock_batch_processor_cls.return_value = mock_processor
        
        # 1. 有効なルーチン、無効なルーチン、is_active未定義のルーチンのデータを用意
        active_routine = {
            "id": "routine_active",
            "title": "Active Routine",
            "routine_type": "ACTION",
            "frequency": {"type": "DAILY"},
            "is_active": True,
            "order": 1
        }
        inactive_routine = {
            "id": "routine_inactive",
            "title": "Inactive Routine",
            "routine_type": "ACTION",
            "frequency": {"type": "DAILY"},
            "is_active": False,
            "order": 2
        }
        default_active_routine = {
            "id": "routine_default",
            "title": "Default Active Routine",
            "routine_type": "ACTION",
            "frequency": {"type": "DAILY"},
            # is_active フィールドなし（既存データの想定）
            "order": 3
        }

        # Mock stream
        mock_stream_result = [
            MagicMock(to_dict=lambda: active_routine),
            MagicMock(to_dict=lambda: inactive_routine),
            MagicMock(to_dict=lambda: default_active_routine)
        ]
        
        # db.collection("routines").where(...).stream() が返す値を設定
        self.mock_db.collection.return_value.where.return_value.stream.return_value = mock_stream_result
        
        # daily_tasks の既存ドキュメントは空とする
        self.mock_db.collection.return_value.where.return_value.where.return_value.stream.return_value = []
        
        # 過去の日付を設定して scheduled_time のチェックをバイパスする
        target_date = date(2026, 6, 1)

        # 実行
        tasks.generate_daily_tasks(target_date=target_date, db=self.mock_db)
        
        # 検証：set されたドキュメントのIDを確認
        set_calls = mock_processor.set.call_args_list
        created_ids = []
        for call in set_calls:
            doc_ref = call[0][0]
            # mock_db.collection(...).document(doc_id) のモックの引数からIDを取得
            # または set_calls を記録した時の doc_ref から調べる
            # ここでは doc_ref が Mock オブジェクトなので、doc_ref.id ではなく、doc_ref を生成したときの名前などを取得するか、
            # tasks.py 内で `db.collection("daily_tasks").document(doc_id)` を呼び出している箇所を検証する
            pass

        # 別の検証アプローチ: db.collection("daily_tasks").document が呼ばれたときの引数（ID）を検証する
        document_calls = self.mock_db.collection.return_value.document.call_args_list
        called_ids = [call[0][0] for call in document_calls if call[0]]
        
        # active と default_active のID（routine_id + _target_date）が含まれていること
        self.assertTrue(any("routine_active" in cid for cid in called_ids))
        self.assertTrue(any("routine_default" in cid for cid in called_ids))
        
        # inactive のIDが含まれていないこと
        self.assertFalse(any("routine_inactive" in cid for cid in called_ids))

if __name__ == '__main__':
    unittest.main()
