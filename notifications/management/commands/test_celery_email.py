from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Test Celery email sending by dispatching a verification email task'

    def add_arguments(self, parser):
        parser.add_argument('--user-id', type=int, help='User ID to send test email to')
        parser.add_argument('--list-users', action='store_true', help='List users')

    def handle(self, *args, **options):
        if options['list_users']:
            from users.models import UserProfile
            for u in UserProfile.objects.all()[:10]:
                self.stdout.write(f'  {u.id}: {u.username} ({u.email})')
            return

        user_id = options.get('user_id')
        if not user_id:
            self.stderr.write('Provide --user-id or --list-users')
            return

        from notifications.tasks import send_verification_email
        result = send_verification_email.delay(user_id)
        self.stdout.write(self.style.SUCCESS(f'Task dispatched: {result.id}'))
