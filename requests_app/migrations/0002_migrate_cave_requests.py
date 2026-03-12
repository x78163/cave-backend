"""Copy existing CaveRequest records to the new generic Request model."""
from django.db import migrations


def forward(apps, schema_editor):
    CaveRequest = apps.get_model('caves', 'CaveRequest')
    Request = apps.get_model('requests_app', 'Request')

    for cr in CaveRequest.objects.all():
        Request.objects.create(
            id=cr.id,
            request_type=cr.request_type,
            status=cr.status,
            requester=cr.requester,
            target_user=cr.cave.owner if cr.cave else None,
            cave=cr.cave,
            message=cr.message,
            payload=cr.payload,
            resolved_by=cr.resolved_by,
            resolved_at=cr.resolved_at,
            created_at=cr.created_at,
        )


def backward(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('requests_app', '0001_initial'),
        ('caves', '0021_add_cave_access_request_type'),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
