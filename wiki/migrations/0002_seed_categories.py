"""Seed top-level wiki categories."""

from django.db import migrations


CATEGORIES = [
    {'name': 'Biology', 'slug': 'biology', 'icon': '', 'order': 1,
     'description': 'Cave-adapted species, troglobites, bats, fungi, and cave ecosystems'},
    {'name': 'Geology', 'slug': 'geology', 'icon': '', 'order': 2,
     'description': 'Karst processes, speleogenesis, formations, speleothems, and mineralogy'},
    {'name': 'Hydrology', 'slug': 'hydrology', 'icon': '', 'order': 3,
     'description': 'Underground rivers, springs, siphons, water tracing, and aquifers'},
    {'name': 'Equipment & Hardware', 'slug': 'equipment-hardware', 'icon': '', 'order': 4,
     'description': 'Helmets, lights, ropes, survey instruments, LiDAR, and cave mapping devices'},
    {'name': 'Techniques', 'slug': 'techniques', 'icon': '', 'order': 5,
     'description': 'SRT, surveying, cave photography, rigging, and navigation'},
    {'name': 'Safety & Rescue', 'slug': 'safety-rescue', 'icon': '', 'order': 6,
     'description': 'Cave rescue procedures, first aid, hazard awareness, and emergency protocols'},
    {'name': 'Conservation & Ethics', 'slug': 'conservation-ethics', 'icon': '', 'order': 7,
     'description': 'Cave conservation, minimal impact caving, gate management, and White Nose Syndrome'},
    {'name': 'History & Exploration', 'slug': 'history-exploration', 'icon': '', 'order': 8,
     'description': 'History of speleology, famous explorations, caving pioneers, and expedition reports'},
    {'name': 'Cartography & Mapping', 'slug': 'cartography-mapping', 'icon': '', 'order': 9,
     'description': 'Cave surveying standards, map symbols, SLAM mapping, and digital cartography'},
    {'name': 'Legal & Access', 'slug': 'legal-access', 'icon': '', 'order': 10,
     'description': 'Cave access rights, permitting, landowner relations, and cave protection laws'},
]


def seed_categories(apps, schema_editor):
    Category = apps.get_model('wiki', 'Category')
    for cat in CATEGORIES:
        Category.objects.get_or_create(slug=cat['slug'], defaults=cat)


def remove_categories(apps, schema_editor):
    Category = apps.get_model('wiki', 'Category')
    slugs = [c['slug'] for c in CATEGORIES]
    Category.objects.filter(slug__in=slugs).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('wiki', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed_categories, remove_categories),
    ]
