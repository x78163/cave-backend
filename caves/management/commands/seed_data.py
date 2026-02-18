"""
Seed cave-backend with realistic sample data.

Cave profiles match the cave-server format exactly (same fields, same structure)
so data synced from devices looks identical to cloud-native entries.

Usage:  python manage.py seed_data
        python manage.py seed_data --flush   (wipe existing data first)
"""

from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta
import random

from caves.models import (
    Cave, CavePhoto, CaveComment, DescriptionRevision,
    CavePermission,
)
from users.models import UserProfile, Grotto, GrottoMembership
from social.models import (
    CaveRating, UserFollow, Activity, Expedition, ExpeditionMember,
)


# ── Cave data ──────────────────────────────────────────────────
# Matches cave-server field schema exactly
CAVES = [
    {
        'name': 'Mammoth Cave System',
        'description': 'The longest known cave system in the world, with over 400 miles of surveyed passageways beneath the Green River valley.',
        'latitude': 37.1870,
        'longitude': -86.1005,
        'region': 'Kentucky',
        'country': 'United States',
        'total_length': 676000.0,
        'largest_chamber': 1200.0,
        'smallest_passage': 0.3,
        'vertical_extent': 115.0,
        'number_of_levels': 5,
        'hazard_count': 3,
        'toxic_gas_present': False,
        'water_present': True,
        'water_description': 'Underground rivers, seasonal flooding in lower levels',
        'requires_equipment': 'Standard caving gear, waders for river sections',
        'has_map': False,
        'source': 'imported',
        'visibility': 'public',
        'wiki_description': (
            "# Mammoth Cave System\n\n"
            "The **Mammoth Cave System** is the world's longest known cave system, "
            "with more than 676 km (420 mi) of surveyed passageways. Located in "
            "central Kentucky beneath Mammoth Cave National Park, the cave system "
            "was carved by the Green River and its tributaries through Mississippian-age "
            "limestone.\n\n"
            "## Geology\n\n"
            "The cave formed in the St. Louis and Ste. Genevieve limestone formations, "
            "capped by a resistant sandstone layer (Big Clifty Sandstone) that protects "
            "the underlying passages from collapse. Five distinct levels correspond to "
            "paleo-water-table positions as the Green River incised its valley.\n\n"
            "## Notable Passages\n\n"
            "- **Broadway** — A wide, flat-ceilinged trunk passage, one of the most "
            "visited sections\n"
            "- **Frozen Niagara** — A spectacular flowstone cascade\n"
            "- **Fat Man's Misery** — A tight, winding canyon passage\n"
            "- **Bottomless Pit** — A 32 m deep vertical shaft\n\n"
            "## Hydrology\n\n"
            "The Echo River and River Styx flow through the lowest levels. Seasonal "
            "flooding can raise water levels dramatically, making lower passages "
            "dangerous during wet periods.\n"
        ),
    },
    {
        'name': 'Lechuguilla Cave',
        'description': 'A deep limestone cave known for extraordinary speleothem formations and pristine conditions.',
        'latitude': 32.1423,
        'longitude': -104.5056,
        'region': 'New Mexico',
        'country': 'United States',
        'total_length': 242000.0,
        'largest_chamber': 4800.0,
        'smallest_passage': 0.25,
        'vertical_extent': 489.0,
        'number_of_levels': 4,
        'hazard_count': 5,
        'toxic_gas_present': True,
        'toxic_gas_types': 'H2S in deep sections',
        'water_present': True,
        'water_description': 'Underground pools, crystal-clear lakes',
        'requires_equipment': 'Vertical gear, gas detector, permit required',
        'has_map': False,
        'source': 'imported',
        'visibility': 'public',
        'wiki_description': (
            "# Lechuguilla Cave\n\n"
            "**Lechuguilla Cave** is located within Carlsbad Caverns National Park in "
            "the Guadalupe Mountains of southeastern New Mexico. It is the deepest "
            "limestone cave in the United States (489 m / 1,604 ft) and the "
            "third-longest in the country.\n\n"
            "## Formation\n\n"
            "Unlike most caves formed by carbonic acid dissolution, Lechuguilla was "
            "carved by **sulfuric acid speleogenesis** — hydrogen sulfide rising from "
            "deep oil and gas deposits reacted with oxygenated groundwater to produce "
            "sulfuric acid, aggressively dissolving the Capitan Reef limestone.\n\n"
            "## Formations\n\n"
            "The cave is renowned for its rare and delicate speleothems:\n\n"
            "- **Gypsum chandeliers** — Fragile crystalline structures up to 6 m long\n"
            "- **Subaqueous helictites** — Formed underwater in mineral-rich pools\n"
            "- **Cave pearls** — Perfectly round concretions in rimstone pools\n"
            "- **Hydromagnesite balloons** — Paper-thin mineral shells\n\n"
            "## Access\n\n"
            "Entry is restricted to approved scientific research expeditions. The cave "
            "is considered one of the most pristine underground environments on Earth.\n"
        ),
    },
    {
        'name': 'Postojna Cave',
        'description': 'A 24 km karst cave system in Slovenia, famous for its underground railway and the olm salamander.',
        'latitude': 45.7828,
        'longitude': 14.2043,
        'region': 'Inner Carniola',
        'country': 'Slovenia',
        'total_length': 24120.0,
        'largest_chamber': 3000.0,
        'smallest_passage': 0.8,
        'vertical_extent': 115.0,
        'number_of_levels': 3,
        'hazard_count': 1,
        'toxic_gas_present': False,
        'water_present': True,
        'water_description': 'Pivka River flows through lower galleries',
        'requires_equipment': 'Tourist sections require no special gear',
        'has_map': False,
        'source': 'imported',
        'visibility': 'public',
        'wiki_description': (
            "# Postojna Cave\n\n"
            "**Postojna Cave** (Postojnska jama) is a 24.1 km long karst cave system "
            "in southwestern Slovenia. It is the second-longest cave system in the "
            "country and has been a major tourist destination since 1819.\n\n"
            "## The Pivka River\n\n"
            "The cave was carved by the Pivka River, which sinks underground at "
            "Postojna and resurfaces 9 km to the northwest at Planina Cave. The "
            "active river passage is in the lowest level; tourist galleries follow "
            "abandoned upper passages.\n\n"
            "## Biology\n\n"
            "Postojna is the type locality for the **olm** (*Proteus anguinus*), "
            "Europe's only cave-adapted vertebrate. This blind, unpigmented amphibian "
            "can live over 100 years and was historically mistaken for a baby dragon.\n\n"
            "## Underground Railway\n\n"
            "A unique electric railway carries visitors 3.7 km into the cave — the "
            "only such system in any show cave worldwide. It has operated since 1872 "
            "(originally gas-powered).\n"
        ),
    },
    {
        'name': 'Son Doong Cave',
        'description': 'The world\'s largest cave passage by volume, located in Phong Nha-Ke Bang National Park.',
        'latitude': 17.5434,
        'longitude': 106.1459,
        'region': 'Quang Binh Province',
        'country': 'Vietnam',
        'total_length': 9000.0,
        'largest_chamber': 38400.0,
        'smallest_passage': 2.0,
        'vertical_extent': 200.0,
        'number_of_levels': 1,
        'hazard_count': 4,
        'toxic_gas_present': False,
        'water_present': True,
        'water_description': 'Underground river, seasonal flooding to 90m depth',
        'requires_equipment': 'Full expedition gear, ropes, camping equipment, guided permit required',
        'has_map': False,
        'source': 'imported',
        'visibility': 'public',
        'wiki_description': (
            "# Son Doong Cave\n\n"
            "**Hang Son Doong** (Mountain River Cave) is the world's largest known "
            "cave passage by volume. Located in Phong Nha-Ke Bang National Park in "
            "Vietnam's Quang Binh Province, its main passage is over 5 km long, "
            "200 m high, and 150 m wide.\n\n"
            "## Discovery\n\n"
            "A local man named Ho Khanh found the entrance in 1991 but could not "
            "relocate it for years. In 2009, a British-Vietnamese expedition team led "
            "by Howard Limbert explored and surveyed the cave, confirming it as the "
            "largest cave passage on Earth.\n\n"
            "## Underground Jungle\n\n"
            "Two massive dolines (ceiling collapses) allow sunlight to reach the cave "
            "floor, creating **underground jungles** with trees up to 30 m tall. These "
            "isolated ecosystems contain species not found elsewhere.\n\n"
            "## Great Wall of Vietnam\n\n"
            "A 90 m calcite flowstone wall blocks the main passage — dubbed the "
            "\"Great Wall of Vietnam\" — requiring climbing gear to pass.\n\n"
            "## Access\n\n"
            "Visits require a multi-day guided expedition (limited to ~1,000 permits "
            "per year) costing several thousand dollars.\n"
        ),
    },
    {
        'name': 'Waitomo Glowworm Caves',
        'description': 'A limestone cave system famous for its bioluminescent glowworm displays on the cave ceiling.',
        'latitude': -38.2614,
        'longitude': 175.1060,
        'region': 'Waikato',
        'country': 'New Zealand',
        'total_length': 1200.0,
        'largest_chamber': 450.0,
        'smallest_passage': 1.0,
        'vertical_extent': 25.0,
        'number_of_levels': 2,
        'hazard_count': 1,
        'toxic_gas_present': False,
        'water_present': True,
        'water_description': 'Underground river with boat passage',
        'requires_equipment': 'None for tourist section; wetsuit for black water rafting',
        'has_map': False,
        'source': 'imported',
        'visibility': 'public',
        'wiki_description': (
            "# Waitomo Glowworm Caves\n\n"
            "The **Waitomo Glowworm Caves** are a network of limestone caves in "
            "the Waikato region of New Zealand's North Island. They are renowned "
            "for the thousands of bioluminescent glowworms (*Arachnocampa luminosa*) "
            "that illuminate the cave ceilings like a starry sky.\n\n"
            "## The Glowworms\n\n"
            "*Arachnocampa luminosa* is a species of fungus gnat endemic to New "
            "Zealand. The larval stage produces bioluminescent light from its tail to "
            "attract prey into sticky silk threads. The effect resembles thousands of "
            "tiny blue-green stars on the cave ceiling.\n\n"
            "## Boat Ride\n\n"
            "The highlight is a silent boat ride through the **Glowworm Grotto**, "
            "where the ceiling is densely populated with larvae. Visitors float "
            "beneath the display in complete darkness.\n\n"
            "## Black Water Rafting\n\n"
            "The Ruakuri Cave system offers adventure caving — floating through "
            "underground rivers on inflatable tubes surrounded by glowworm displays.\n"
        ),
    },
    {
        'name': 'Eisriesenwelt',
        'description': 'The world\'s largest ice cave, located in the Tennengebirge mountains of the Austrian Alps.',
        'latitude': 47.5030,
        'longitude': 13.1894,
        'region': 'Salzburg',
        'country': 'Austria',
        'total_length': 42000.0,
        'largest_chamber': 2000.0,
        'smallest_passage': 1.5,
        'vertical_extent': 407.0,
        'number_of_levels': 3,
        'hazard_count': 2,
        'toxic_gas_present': False,
        'water_present': True,
        'water_description': 'Ice formations, seasonal meltwater',
        'requires_equipment': 'Warm clothing, good footwear; carbide lamps provided on tour',
        'has_map': False,
        'source': 'imported',
        'visibility': 'public',
        'wiki_description': (
            "# Eisriesenwelt\n\n"
            "**Eisriesenwelt** (\"World of the Ice Giants\") is the world's largest "
            "ice cave, extending 42 km into the Hochkogel mountain in the "
            "Tennengebirge range near Salzburg, Austria. Only the first kilometre "
            "contains ice; the remainder is ordinary limestone cave.\n\n"
            "## Ice Formations\n\n"
            "The ice forms through a chimney effect — cold winter air flows into the "
            "cave and freezes seeping water. In summer, cold air trapped in lower "
            "passages prevents melting. The ice is up to 20 m thick in places and "
            "takes spectacular forms:\n\n"
            "- **Hymir's Castle** — A towering ice wall\n"
            "- **The Ice Palace** — Massive ice columns and curtains\n"
            "- **Frigga's Veil** — A frozen waterfall formation\n\n"
            "## Discovery & Access\n\n"
            "Discovered by Anton Posselt in 1879, the cave is accessible May through "
            "October via a cable car and steep trail to the entrance at 1,641 m "
            "elevation. Tours use traditional carbide lamps, creating a dramatic "
            "atmosphere.\n"
        ),
    },
    {
        'name': 'Cenote Dos Ojos',
        'description': 'An underwater cave system in the Yucatan Peninsula, one of the longest underwater cave networks in the world.',
        'latitude': 20.3264,
        'longitude': -87.3911,
        'region': 'Quintana Roo',
        'country': 'Mexico',
        'total_length': 82000.0,
        'largest_chamber': 800.0,
        'smallest_passage': 0.6,
        'vertical_extent': 35.0,
        'number_of_levels': 2,
        'hazard_count': 6,
        'toxic_gas_present': False,
        'water_present': True,
        'water_description': 'Fully submerged passages, freshwater/saltwater halocline',
        'requires_equipment': 'Cave diving certification, twin tanks, guideline reel, backup lights',
        'has_map': False,
        'source': 'imported',
        'visibility': 'public',
        'wiki_description': (
            "# Cenote Dos Ojos\n\n"
            "**Sistema Dos Ojos** (Two Eyes System) is an underwater cave system "
            "in the Yucatan Peninsula of Mexico. It is part of the immense "
            "interconnected network of flooded passages that underlies the entire "
            "Caribbean coast of Quintana Roo.\n\n"
            "## The Halocline\n\n"
            "One of the most striking features is the **halocline** — a visible "
            "boundary where fresh cenote water meets saltwater that has infiltrated "
            "from the coast. Diving through the halocline creates a surreal "
            "shimmering visual effect.\n\n"
            "## Speleothems\n\n"
            "The passages are decorated with spectacular stalactites and stalagmites "
            "that formed when the caves were dry during ice ages (lower sea levels). "
            "Now submerged, they are preserved in pristine condition.\n\n"
            "## Cave Diving\n\n"
            "Dos Ojos is one of the most popular cave diving destinations in the "
            "world. The Barbie Line and Bat Cave routes offer both beginner-friendly "
            "and advanced dive profiles.\n"
        ),
    },
    {
        'name': 'Krubera Cave',
        'description': 'The second deepest known cave on Earth, located in the Arabika Massif of the Western Caucasus.',
        'latitude': 43.4094,
        'longitude': 40.3621,
        'region': 'Gagra District',
        'country': 'Georgia',
        'total_length': 16058.0,
        'largest_chamber': 500.0,
        'smallest_passage': 0.2,
        'vertical_extent': 2197.0,
        'number_of_levels': 7,
        'hazard_count': 8,
        'toxic_gas_present': True,
        'toxic_gas_types': 'CO2 accumulation in deep sections',
        'max_particulate': 45.0,
        'water_present': True,
        'water_description': 'Underground river, terminal sump at -2197m',
        'requires_equipment': 'Full expedition vertical gear, diving equipment for terminal sump, multi-day camping supplies',
        'has_map': False,
        'source': 'imported',
        'visibility': 'public',
        'wiki_description': (
            "# Krubera Cave\n\n"
            "**Krubera Cave** (Voronya Cave) is the second deepest known cave on "
            "Earth at 2,197 m depth. Located in the Arabika Massif of the Western "
            "Caucasus mountains in Georgia's Gagra District, it held the world depth "
            "record from 2001 to 2017.\n\n"
            "## Exploration History\n\n"
            "Ukrainian speleologists pushed the cave to successive world records:\n\n"
            "- **2001**: Reached -1,710 m, surpassing Lamprechtsofen\n"
            "- **2004**: -2,080 m via the \"Game Over\" branch\n"
            "- **2012**: Gennady Samokhin dove the terminal sump to -2,197 m\n\n"
            "## Structure\n\n"
            "The cave is characterized by a series of deep vertical shafts "
            "connected by meanders. Major branch points create a complex multi-level "
            "system. The main route involves numerous pitches exceeding 100 m.\n\n"
            "## Conditions\n\n"
            "Expeditions require weeks of underground camping. Temperatures hover "
            "around 5-7°C, with high humidity and CO2 accumulation in the deepest "
            "sections making breathing laborious.\n"
        ),
    },
]


# ── Users ──────────────────────────────────────────────────────
USERS = [
    {'username': 'admin', 'email': 'admin@cavemapper.io', 'is_staff': True, 'is_superuser': True,
     'bio': 'Platform administrator', 'location': 'Cloud'},
    {'username': 'elena_karst', 'email': 'elena@caving.org',
     'bio': 'Karst geologist and expedition leader. 15 years of cave survey experience.', 'location': 'Ljubljana, Slovenia'},
    {'username': 'marco_deepcave', 'email': 'marco@deepcave.it',
     'bio': 'Deep caving specialist. Focused on vertical systems in the Caucasus and Dinaric Alps.', 'location': 'Trieste, Italy'},
    {'username': 'sarah_mapping', 'email': 'sarah@cavemap.net',
     'bio': 'LiDAR cave mapping researcher. Building better tools for underground survey.', 'location': 'Bowling Green, KY'},
    {'username': 'jun_aquifer', 'email': 'jun@cave-dive.mx',
     'bio': 'Cave diving instructor and cenote explorer. NACD full cave certified.', 'location': 'Tulum, Mexico'},
    {'username': 'priya_bio', 'email': 'priya@biospeleo.in',
     'bio': 'Biospeleologist studying cave-adapted fauna. Passionate about conservation.', 'location': 'Meghalaya, India'},
]

PASSWORD = 'testpass123'


# ── Comments ───────────────────────────────────────────────────
COMMENTS = {
    'Mammoth Cave System': [
        ('sarah_mapping', 'The Broadway passage would be perfect for LiDAR scanning — wide, flat ceiling, minimal moisture. Planning a mapping trip for spring.'),
        ('elena_karst', 'Five levels of passage development! The geomorphology here is a textbook example of phreatic to vadose transition.'),
        ('priya_bio', 'The cave cricket and eyeless crayfish populations here are incredible. True flagship species for cave conservation.'),
    ],
    'Lechuguilla Cave': [
        ('marco_deepcave', 'The sulfuric acid speleogenesis makes this completely unlike any other cave I have visited. The gypsum chandeliers are otherworldly.'),
        ('elena_karst', 'Access restrictions are frustrating but completely justified. This cave is irreplaceable.'),
        ('sarah_mapping', 'The existing LIDAR survey data from the NPS is phenomenal. Would love to see it in our 3D viewer.'),
    ],
    'Son Doong Cave': [
        ('marco_deepcave', 'The scale is impossible to convey in photos. Standing in the main passage feels like being in a cathedral the size of a city block.'),
        ('jun_aquifer', 'The underground river here during monsoon season is no joke. Water levels can rise 80+ meters.'),
    ],
    'Krubera Cave': [
        ('marco_deepcave', 'Spent 3 weeks underground on the 2019 expedition. The psychological challenge at depth is as real as the physical one.'),
        ('elena_karst', 'The CO2 levels below -1800m require careful monitoring. We measured 3.5% in the Game Over branch.'),
    ],
    'Cenote Dos Ojos': [
        ('jun_aquifer', 'The halocline effect here is the best I have seen anywhere on the Riviera Maya. Crystal clear vis in the fresh layer.'),
        ('priya_bio', 'We found a new species of remipede in the deeper passages last year. Manuscript is in review.'),
    ],
    'Postojna Cave': [
        ('priya_bio', 'The Proteus anguinus breeding program here is a global model for cave species conservation.'),
        ('elena_karst', 'A classic example of a river cave system. The Pivka has carved these passages over millions of years.'),
    ],
}


# ── Ratings ────────────────────────────────────────────────────
RATINGS = {
    'Mammoth Cave System': [
        ('elena_karst', 5, 'Unparalleled in scale and geological diversity. Every caver should visit.'),
        ('sarah_mapping', 5, 'The sheer extent of surveyed passage is mind-boggling.'),
        ('marco_deepcave', 4, 'Impressive length but the tourist sections feel over-managed.'),
        ('priya_bio', 5, 'Amazing biodiversity. The cave ecosystem here is one of the richest on earth.'),
    ],
    'Lechuguilla Cave': [
        ('elena_karst', 5, 'The most beautiful cave on the planet. Period.'),
        ('marco_deepcave', 5, 'Pristine conditions and formations you will not see anywhere else.'),
        ('sarah_mapping', 5, ''),
    ],
    'Son Doong Cave': [
        ('marco_deepcave', 5, 'The largest cave passage in the world — nothing else compares.'),
        ('jun_aquifer', 5, 'Life-changing expedition. The underground jungle is surreal.'),
        ('elena_karst', 5, 'A geological wonder. The dolines create unique micro-ecosystems.'),
    ],
    'Postojna Cave': [
        ('elena_karst', 4, 'Well-managed show cave with genuine scientific importance.'),
        ('priya_bio', 5, 'The olm exhibit alone makes this a must-visit for any biospeleologist.'),
        ('sarah_mapping', 3, 'Beautiful but very touristy. The train ride is fun though.'),
    ],
    'Waitomo Glowworm Caves': [
        ('priya_bio', 5, 'Arachnocampa luminosa in such density is breathtaking. Truly magical.'),
        ('elena_karst', 4, 'Unique biological display. The boat ride through the grotto is unforgettable.'),
    ],
    'Eisriesenwelt': [
        ('elena_karst', 4, 'The carbide lamp tour creates an incredible atmosphere. Ice formations are massive.'),
        ('marco_deepcave', 4, 'Impressive ice but I wish the tour went deeper into the system.'),
    ],
    'Cenote Dos Ojos': [
        ('jun_aquifer', 5, 'My home system. World-class cave diving with something for every level.'),
        ('marco_deepcave', 4, 'Stunning underwater speleothems. The Barbie Line is a perfect intro dive.'),
        ('elena_karst', 4, 'Fascinating geology — submerged Pleistocene formations preserved perfectly.'),
    ],
    'Krubera Cave': [
        ('marco_deepcave', 5, 'The deepest I have ever been. A humbling and unforgettable experience.'),
        ('elena_karst', 5, 'A benchmark for deep caving. The geology of the Arabika Massif is extraordinary.'),
    ],
}


class Command(BaseCommand):
    help = 'Seed cave-backend with sample caves, users, ratings, comments, and social data'

    def add_arguments(self, parser):
        parser.add_argument(
            '--flush', action='store_true',
            help='Delete all existing data before seeding',
        )

    def handle(self, *args, **options):
        if options['flush']:
            self.stdout.write('Flushing existing data...')
            ExpeditionMember.objects.all().delete()
            Expedition.objects.all().delete()
            Activity.objects.all().delete()
            UserFollow.objects.all().delete()
            CaveRating.objects.all().delete()
            CaveComment.objects.all().delete()
            DescriptionRevision.objects.all().delete()
            CavePhoto.objects.all().delete()
            CavePermission.objects.all().delete()
            Cave.objects.all().delete()
            GrottoMembership.objects.all().delete()
            Grotto.objects.all().delete()
            UserProfile.objects.all().delete()
            User.objects.filter(is_superuser=False).delete()
            # Keep existing superuser if any
            self.stdout.write(self.style.WARNING('  Data flushed.'))

        # ── Create users ──
        self.stdout.write('Creating users...')
        users = {}
        for u in USERS:
            user, created = User.objects.get_or_create(
                username=u['username'],
                defaults={
                    'email': u['email'],
                    'is_staff': u.get('is_staff', False),
                    'is_superuser': u.get('is_superuser', False),
                },
            )
            if created:
                user.set_password(PASSWORD)
                user.save()

            profile, _ = UserProfile.objects.get_or_create(
                user=user,
                defaults={
                    'bio': u.get('bio', ''),
                    'location': u.get('location', ''),
                },
            )
            users[u['username']] = user
            status = 'created' if created else 'exists'
            self.stdout.write(f'  {u["username"]} ({status})')

        # ── Create grotto ──
        self.stdout.write('Creating grotto...')
        grotto, _ = Grotto.objects.get_or_create(
            name='International Cave Mapping Collective',
            defaults={
                'description': 'A collaborative group dedicated to open-source cave survey and 3D mapping.',
                'website': 'https://cavemapper.io',
                'created_by': users['admin'],
            },
        )
        for username in ['elena_karst', 'marco_deepcave', 'sarah_mapping', 'jun_aquifer', 'priya_bio']:
            GrottoMembership.objects.get_or_create(
                user=users[username], grotto=grotto,
                defaults={'role': 'admin' if username == 'elena_karst' else 'member'},
            )

        # ── Create caves ──
        self.stdout.write('Creating caves...')
        caves = {}
        for c in CAVES:
            wiki = c.pop('wiki_description')
            cave, created = Cave.objects.get_or_create(
                name=c['name'],
                defaults={
                    **{k: v for k, v in c.items() if k != 'name'},
                    'owner': users['admin'],
                },
            )
            caves[c['name']] = cave

            if created:
                # Create wiki-style description revision
                DescriptionRevision.objects.create(
                    cave=cave,
                    content=wiki,
                    edit_summary='Initial description',
                    editor_name='admin',
                    revision_number=1,
                    editor=users['admin'],
                )
                cave.description = wiki
                cave.save(update_fields=['description'])

            status = 'created' if created else 'exists'
            self.stdout.write(f'  {c["name"]} ({status})')

        # ── Create comments ──
        self.stdout.write('Creating comments...')
        comment_count = 0
        for cave_name, comment_list in COMMENTS.items():
            cave = caves.get(cave_name)
            if not cave:
                continue
            for username, text in comment_list:
                user = users.get(username)
                if not user:
                    continue
                _, created = CaveComment.objects.get_or_create(
                    cave=cave, author=user, text=text,
                    defaults={'author_name': username},
                )
                if created:
                    comment_count += 1
        self.stdout.write(f'  {comment_count} comments created')

        # ── Create ratings ──
        self.stdout.write('Creating ratings...')
        rating_count = 0
        for cave_name, rating_list in RATINGS.items():
            cave = caves.get(cave_name)
            if not cave:
                continue
            for username, score, review in rating_list:
                user = users.get(username)
                if not user:
                    continue
                _, created = CaveRating.objects.get_or_create(
                    cave=cave, user=user,
                    defaults={'rating': score, 'review_text': review},
                )
                if created:
                    rating_count += 1
        self.stdout.write(f'  {rating_count} ratings created')

        # ── Create follows ──
        self.stdout.write('Creating follow relationships...')
        follow_pairs = [
            ('sarah_mapping', 'elena_karst'),
            ('sarah_mapping', 'marco_deepcave'),
            ('marco_deepcave', 'elena_karst'),
            ('marco_deepcave', 'jun_aquifer'),
            ('jun_aquifer', 'marco_deepcave'),
            ('jun_aquifer', 'priya_bio'),
            ('priya_bio', 'elena_karst'),
            ('priya_bio', 'jun_aquifer'),
            ('elena_karst', 'marco_deepcave'),
            ('elena_karst', 'sarah_mapping'),
        ]
        follow_count = 0
        for follower_name, following_name in follow_pairs:
            _, created = UserFollow.objects.get_or_create(
                follower=users[follower_name],
                following=users[following_name],
            )
            if created:
                follow_count += 1
        self.stdout.write(f'  {follow_count} follows created')

        # ── Create expeditions ──
        self.stdout.write('Creating expeditions...')
        now = timezone.now()
        expeditions_data = [
            {
                'name': 'Mammoth Cave LiDAR Survey — Broadway Section',
                'description': 'Week-long LiDAR mapping expedition to scan the Broadway passage and surrounding galleries.',
                'cave': 'Mammoth Cave System',
                'organizer': 'sarah_mapping',
                'planned_date': now + timedelta(days=45),
                'status': 'confirmed',
                'max_members': 6,
                'members': [
                    ('elena_karst', 'confirmed'),
                    ('marco_deepcave', 'confirmed'),
                    ('priya_bio', 'invited'),
                ],
            },
            {
                'name': 'Krubera Deep Camp — 2026 Push',
                'description': 'Multi-week expedition targeting new passage below -2000m in the Non-Kuznetskaya branch.',
                'cave': 'Krubera Cave',
                'organizer': 'marco_deepcave',
                'planned_date': now + timedelta(days=120),
                'status': 'planning',
                'max_members': 12,
                'members': [
                    ('elena_karst', 'confirmed'),
                ],
            },
            {
                'name': 'Dos Ojos Survey Dive — Unexplored Northern Extension',
                'description': 'Cave diving survey of the newly discovered northern passage beyond the Bat Cave route.',
                'cave': 'Cenote Dos Ojos',
                'organizer': 'jun_aquifer',
                'planned_date': now + timedelta(days=30),
                'status': 'confirmed',
                'max_members': 4,
                'members': [
                    ('marco_deepcave', 'confirmed'),
                ],
            },
            {
                'name': 'Postojna Biospeleology Field Course',
                'description': 'Educational expedition studying cave-adapted fauna with focus on Proteus anguinus habitat monitoring.',
                'cave': 'Postojna Cave',
                'organizer': 'priya_bio',
                'planned_date': now - timedelta(days=15),
                'status': 'completed',
                'max_members': 8,
                'members': [
                    ('elena_karst', 'confirmed'),
                    ('sarah_mapping', 'confirmed'),
                ],
            },
        ]

        for exp_data in expeditions_data:
            members = exp_data.pop('members')
            cave = caves.get(exp_data.pop('cave'))
            organizer = users.get(exp_data.pop('organizer'))
            if not cave or not organizer:
                continue

            expedition, created = Expedition.objects.get_or_create(
                name=exp_data['name'],
                defaults={
                    **exp_data,
                    'cave': cave,
                    'organizer': organizer,
                },
            )
            if created:
                for member_name, member_status in members:
                    ExpeditionMember.objects.get_or_create(
                        expedition=expedition,
                        user=users[member_name],
                        defaults={'status': member_status},
                    )
                self.stdout.write(f'  {exp_data["name"][:50]}... (created)')

        # ── Summary ──
        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS('Seed data complete!'))
        self.stdout.write(f'  Users:       {User.objects.count()}')
        self.stdout.write(f'  Caves:       {Cave.objects.count()}')
        self.stdout.write(f'  Comments:    {CaveComment.objects.count()}')
        self.stdout.write(f'  Ratings:     {CaveRating.objects.count()}')
        self.stdout.write(f'  Follows:     {UserFollow.objects.count()}')
        self.stdout.write(f'  Expeditions: {Expedition.objects.count()}')
        self.stdout.write(f'  Activities:  {Activity.objects.count()}')
        self.stdout.write(f'\n  All passwords: {PASSWORD}')
