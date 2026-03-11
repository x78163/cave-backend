from django.core.management.base import BaseCommand
from django.core.mail import send_mail
from django.conf import settings


class Command(BaseCommand):
    help = 'Test email sending'

    def handle(self, *args, **options):
        self.stdout.write(f'EMAIL_BACKEND: {settings.EMAIL_BACKEND}')
        self.stdout.write(f'EMAIL_HOST: {settings.EMAIL_HOST}')
        self.stdout.write(f'EMAIL_PORT: {settings.EMAIL_PORT}')
        self.stdout.write(f'EMAIL_USE_SSL: {settings.EMAIL_USE_SSL}')
        self.stdout.write(f'EMAIL_HOST_USER: {settings.EMAIL_HOST_USER}')
        self.stdout.write(f'DEFAULT_FROM_EMAIL: {settings.DEFAULT_FROM_EMAIL}')
        self.stdout.write(f'DEBUG: {settings.DEBUG}')

        try:
            send_mail(
                'Test from Cave Dragon',
                'Hello! This is a test email from Cave Dragon.',
                settings.DEFAULT_FROM_EMAIL,
                ['joseph.difrancesco@gmail.com'],
                fail_silently=False,
            )
            self.stdout.write(self.style.SUCCESS('EMAIL SENT SUCCESSFULLY'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'EMAIL FAILED: {e}'))
