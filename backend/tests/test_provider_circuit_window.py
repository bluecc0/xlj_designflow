import unittest
from backend import ai_image


class ProviderCircuitWindowTest(unittest.TestCase):
    def setUp(self):
        ai_image.reset_provider_freeze()
        self.addCleanup(ai_image.reset_provider_freeze)

    def test_old_failure_does_not_accumulate(self):
        ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=100)
        self.assertFalse(ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=401))
        self.assertFalse(ai_image.is_provider_frozen("sub2api", "gpt-image-2.6", now=402))

    def test_inflight_failure_does_not_extend_freeze(self):
        ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=100)
        ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=110)
        ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=200, attempt_started=105)
        self.assertFalse(ai_image.is_provider_frozen("sub2api", "gpt-image-2.6", now=1911))

    def test_late_success_does_not_clear_new_failure(self):
        ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=100)
        ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=110)
        ai_image.record_provider_success("sub2api", "gpt-image-2.6", attempt_started=90)
        self.assertTrue(ai_image.is_provider_frozen("sub2api", "gpt-image-2.6", now=120))

    def test_fresh_success_resets_counter(self):
        ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=100)
        ai_image.record_provider_success("sub2api", "gpt-image-2.6", attempt_started=101)
        self.assertFalse(ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=102))

    def test_expired_freeze_restarts_count(self):
        ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=100)
        ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=110)
        self.assertFalse(ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=1911, attempt_started=1910))

    def test_old_failure_after_expiry_is_ignored(self):
        ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=100)
        ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=110)
        self.assertFalse(ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=1911, attempt_started=105))
        self.assertFalse(ai_image.record_provider_failure("sub2api", "gpt-image-2.6", now=1912, attempt_started=1912))
