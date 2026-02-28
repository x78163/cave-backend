"""
Seed the events system with realistic sample data.

Usage:  python manage.py seed_events
        python manage.py seed_events --flush   (wipe existing events first)
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from caves.models import Cave
from events.models import Event, EventRSVP, EventComment

User = get_user_model()

# ── Sample events ──────────────────────────────────────────────
EVENTS = [
    {
        'name': 'TAG Fall Cave Carnival',
        'event_type': 'social',
        'description': (
            '## Annual Fall Cave Carnival\n\n'
            'Join us for the biggest caving social event of the season! '
            'Meet fellow cavers from across the Southeast, swap stories, '
            'and enjoy campfire cookouts.\n\n'
            '**What to expect:**\n'
            '- Camping at base camp (BYO tent)\n'
            '- Saturday night potluck dinner\n'
            '- Guided cave trips all weekend\n'
            '- Gear swap and vendor area\n'
            '- Evening presentations on exploration projects'
        ),
        'all_day': True,
        'days_from_now': 14,
        'duration_days': 3,
        'address': 'Sequatchie Valley, TN',
        'latitude': 35.38,
        'longitude': -85.65,
        'max_participants': 150,
        'visibility': 'public',
    },
    {
        'name': 'Cumberland Caverns Survey Trip',
        'event_type': 'survey',
        'description': (
            'Continuing the survey of the newly discovered passage in the '
            'upper levels of Cumberland Caverns. We need experienced '
            'survey teams — compass, tape, and Disto skills preferred.\n\n'
            'Meet at the cave entrance at 8:00 AM sharp. '
            'Expected underground time: 6-8 hours.'
        ),
        'all_day': False,
        'days_from_now': 7,
        'duration_hours': 10,
        'address': '1437 Cumberland Caverns Rd, McMinnville, TN 37110',
        'google_maps_link': 'https://maps.google.com/?q=35.6574,-85.8285',
        'latitude': 35.6574,
        'longitude': -85.8285,
        'required_equipment': 'Helmet, 3-source lighting, vertical gear, survey instruments (Disto X2 preferred), knee pads, cave pack',
        'max_participants': 12,
        'visibility': 'public',
    },
    {
        'name': 'Beginner Vertical Training',
        'event_type': 'training',
        'description': (
            '## Introduction to Vertical Caving\n\n'
            'Learn the basics of Single Rope Technique (SRT) in a safe, '
            'above-ground environment. This hands-on workshop covers:\n\n'
            '- Harness fitting and gear inspection\n'
            '- Ascending and descending on rope\n'
            '- Changeover techniques\n'
            '- Knot tying essentials\n'
            '- Rigging fundamentals\n\n'
            '*All gear provided. Wear sturdy boots and comfortable clothing.*'
        ),
        'all_day': False,
        'days_from_now': 10,
        'duration_hours': 6,
        'address': 'Stones River Greenway, Nashville, TN',
        'latitude': 36.1450,
        'longitude': -86.7200,
        'max_participants': 20,
        'visibility': 'public',
    },
    {
        'name': 'Bat Census Weekend',
        'event_type': 'conservation',
        'description': (
            'Annual winter bat population census in coordination with '
            'US Fish & Wildlife Service. We will be counting hibernating '
            'bat populations across 6 caves in the Middle Tennessee region.\n\n'
            '**Important:** Decontamination protocol is mandatory. '
            'All gear must be cleaned with approved solutions before and '
            'after each cave visit. WNS prevention is critical.\n\n'
            'Teams of 3-4 will be assigned to each cave. '
            'Experienced bat counters and photographers needed.'
        ),
        'all_day': True,
        'days_from_now': 21,
        'duration_days': 2,
        'address': 'Warren County, TN',
        'latitude': 35.68,
        'longitude': -85.78,
        'required_equipment': 'Helmet, headlamp, tally counter, camera with red filter, decontamination supplies, clipboard',
        'max_participants': 24,
        'visibility': 'public',
    },
    {
        'name': 'Cave Photography Workshop',
        'event_type': 'education',
        'description': (
            'Learn the art of cave photography from experienced '
            'underground photographers. Topics include:\n\n'
            '- Flash placement and slave triggers\n'
            '- Long exposure techniques\n'
            '- Composition in confined spaces\n'
            '- Post-processing for cave images\n'
            '- Equipment protection from mud and water\n\n'
            'Bring your camera gear. We will have a classroom session '
            'followed by a practical session in a local cave.'
        ),
        'all_day': False,
        'days_from_now': 18,
        'duration_hours': 8,
        'address': 'Cookeville, TN',
        'latitude': 36.1628,
        'longitude': -85.5016,
        'max_participants': 15,
        'visibility': 'public',
    },
    {
        'name': 'Grotto Monthly Meeting',
        'event_type': 'social',
        'description': (
            'Regular monthly meeting of the Nashville Grotto. '
            'This month we have a presentation on the recent '
            'exploration of Blue Spring Cave and planning for '
            'upcoming trip schedules.\n\n'
            'Pizza and drinks provided. Bring a friend interested in caving!'
        ),
        'all_day': False,
        'days_from_now': 5,
        'duration_hours': 3,
        'address': '1000 Church St, Nashville, TN 37203',
        'latitude': 36.1580,
        'longitude': -86.7910,
        'visibility': 'all_grotto',
    },
    {
        'name': 'Elementary School Cave Day',
        'event_type': 'outreach',
        'description': (
            'Volunteer opportunity! We are setting up educational '
            'stations at Harpeth Elementary for their annual science day.\n\n'
            'Stations include:\n'
            '- Cave formation models (build your own stalactite)\n'
            '- Bat ecology presentation\n'
            '- Cave mapping demonstration\n'
            '- Virtual cave tour (3D point cloud viewer)\n'
            '- Caving gear try-on station\n\n'
            'We need 8-10 volunteers. Great for public outreach hours!'
        ),
        'all_day': False,
        'days_from_now': 25,
        'duration_hours': 5,
        'address': 'Kingston Springs, TN',
        'latitude': 36.1001,
        'longitude': -87.1150,
        'max_participants': 10,
        'visibility': 'public',
    },
    {
        'name': 'Blue Spring Cave Expedition',
        'event_type': 'expedition',
        'description': (
            '## Multi-day Expedition — Blue Spring Cave\n\n'
            'A major push trip targeting the far reaches of the cave '
            'system beyond the Third Sump. This is a serious undertaking '
            'requiring experienced, physically fit cavers.\n\n'
            '**Plan:**\n'
            '- Day 1: Establish underground camp at the Big Room\n'
            '- Day 2: Push teams head beyond Third Sump, survey teams '
            'work on side leads near camp\n'
            '- Day 3: Pack out and derig\n\n'
            '*Pre-trip meeting required. Contact expedition leader for details.*'
        ),
        'all_day': True,
        'days_from_now': 35,
        'duration_days': 3,
        'address': 'White County, TN',
        'latitude': 35.9505,
        'longitude': -85.4660,
        'required_equipment': 'Full vertical gear, sleeping system rated to 50°F, 3 days food/water, cave pack, survey instruments, emergency bivvy',
        'max_participants': 8,
        'visibility': 'public',
    },
    {
        'name': 'Cave Rescue Practice',
        'event_type': 'training',
        'description': (
            'Quarterly cave rescue practice exercise with the '
            'Tennessee Cave Rescue Team. This session focuses on '
            'patient packaging and litter hauling through tight '
            'restrictions.\n\n'
            'Open to all interested cavers — rescue team membership '
            'not required. Great learning opportunity!'
        ),
        'all_day': False,
        'days_from_now': 30,
        'duration_hours': 8,
        'address': 'Fall Creek Falls State Park, TN',
        'latitude': 35.6670,
        'longitude': -85.3510,
        'required_equipment': 'Helmet, vertical gear, gloves, sturdy boots',
        'max_participants': 30,
        'visibility': 'public',
    },
    {
        'name': 'Past Event: February Cave Clean-Up',
        'event_type': 'conservation',
        'description': (
            'Community cave clean-up at Dunbar Cave State Park. '
            'We removed over 200 lbs of trash from the entrance area '
            'and first 500 feet of passage. Great turnout!'
        ),
        'all_day': True,
        'days_from_now': -10,
        'duration_days': 1,
        'address': 'Dunbar Cave State Park, Clarksville, TN',
        'latitude': 36.5560,
        'longitude': -87.3170,
        'visibility': 'public',
        'status': 'completed',
    },
]

COMMENTS = [
    "Can't wait for this! Been looking forward to it.",
    "Is there parking available at the meeting point?",
    "I'll bring some extra headlamps for beginners.",
    "What's the difficulty level? I've only been caving a few times.",
    "Signed up! Bringing two friends who are new to caving.",
    "The weather forecast looks great for this weekend!",
    "Do we need to arrange carpooling from Nashville?",
    "Awesome event! Thanks for organizing.",
]


class Command(BaseCommand):
    help = 'Seed the events system with realistic sample data'

    def add_arguments(self, parser):
        parser.add_argument(
            '--flush', action='store_true',
            help='Delete all existing events before seeding',
        )

    def handle(self, *args, **options):
        if options['flush']:
            count = Event.objects.count()
            Event.objects.all().delete()
            self.stdout.write(self.style.WARNING(f'Deleted {count} existing events'))

        # Get or create a user to be the event creator
        user = User.objects.filter(is_staff=True).first()
        if not user:
            user = User.objects.first()
        if not user:
            self.stdout.write(self.style.ERROR('No users found — create a user first'))
            return

        other_users = list(User.objects.exclude(id=user.id)[:10])

        # Try to link some events to existing caves
        caves = list(Cave.objects.all()[:5])

        now = timezone.now()
        created = 0

        for i, ev_data in enumerate(EVENTS):
            days = ev_data['days_from_now']
            start = now + timedelta(days=days)
            if ev_data['all_day']:
                start = start.replace(hour=0, minute=0, second=0, microsecond=0)
            else:
                start = start.replace(hour=9, minute=0, second=0, microsecond=0)

            end = None
            if 'duration_days' in ev_data:
                end = start + timedelta(days=ev_data['duration_days'])
            elif 'duration_hours' in ev_data:
                end = start + timedelta(hours=ev_data['duration_hours'])

            event = Event.objects.create(
                name=ev_data['name'],
                event_type=ev_data['event_type'],
                description=ev_data.get('description', ''),
                start_date=start,
                end_date=end,
                all_day=ev_data.get('all_day', False),
                cave=caves[i % len(caves)] if caves and i < 3 else None,
                latitude=ev_data.get('latitude'),
                longitude=ev_data.get('longitude'),
                address=ev_data.get('address', ''),
                google_maps_link=ev_data.get('google_maps_link', ''),
                created_by=user,
                required_equipment=ev_data.get('required_equipment', ''),
                max_participants=ev_data.get('max_participants'),
                visibility=ev_data.get('visibility', 'public'),
                status=ev_data.get('status', 'published'),
            )

            # Add RSVPs from other users
            rsvp_count = min(len(other_users), max(1, i % 5 + 1))
            for j in range(rsvp_count):
                if j < len(other_users):
                    EventRSVP.objects.create(
                        event=event,
                        user=other_users[j],
                        status='going' if j % 3 != 2 else 'maybe',
                    )

            # Creator RSVPs as going
            EventRSVP.objects.create(event=event, user=user, status='going')

            # Add a comment or two
            if other_users and i < len(COMMENTS):
                EventComment.objects.create(
                    event=event,
                    author=other_users[i % len(other_users)] if other_users else user,
                    text=COMMENTS[i],
                )

            created += 1
            self.stdout.write(f'  Created: {event.name} ({event.event_type})')

        self.stdout.write(self.style.SUCCESS(
            f'\nSeeded {created} events with RSVPs and comments'
        ))
