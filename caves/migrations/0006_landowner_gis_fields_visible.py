from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('caves', '0005_add_tpad_enriched_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='landowner',
            name='gis_fields_visible',
            field=models.BooleanField(
                default=True,
                help_text=(
                    'Show GIS parcel details (owner, address, acreage, etc.). '
                    'TPAD link and polygon boundary always visible.'
                ),
            ),
        ),
    ]
