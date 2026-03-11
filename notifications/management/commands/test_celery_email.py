from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Test Celery email sending by dispatching a verification email task'

    def add_arguments(self, parser):
        parser.add_argument('user_id', type=int, help='User ID to send test email to')

    def handle(self, *args, **options):
        from notifications.tasks import send_verification_email
        user_id = options['user_id']
        result = send_verification_email.delay(user_id)
        self.stdout.write(self.style.SUCCESS(f'Task dispatched: {result.id}'))
        self.stdout.write('Check Celery worker logs for result.')
