"""
Seed 14 Tennessee caves from historical survey data.

Data source: Tennessee cave survey — DMS coordinates, geologic horizons,
quadrangle references, and detailed cave descriptions.

Usage:  python manage.py seed_tn_caves
        python manage.py seed_tn_caves --owner <username>
"""

from django.core.management.base import BaseCommand
from caves.models import Cave
from users.models import UserProfile


def dms(d, m, s, direction):
    """Convert degrees/minutes/seconds to decimal degrees."""
    dec = abs(d) + m / 60 + s / 3600
    if direction in ('S', 'W'):
        dec = -dec
    return round(dec, 6)


CAVES = [
    {
        'name': 'Duck River Cave',
        'latitude': dms(35, 33, 20, 'N'),
        'longitude': dms(86, 35, 18, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** On the north bank of Duck River, about 200 yards west of the river "
            "at mile 200 and 0.5 mile west of Halls Mill, at an elevation of 690 feet.\n\n"
            "**Quadrangle:** Unionville (71-SE)\n\n"
            "**Geologic Horizon:** Ridley limestone\n\n"
            "Two mouths to this cave are known. One opens on the river and the other in a field. "
            "The river mouth is 10 feet wide and 5 feet high, and the other mouth is 25 feet wide "
            "and 10 feet high. From the first to the second opening the cave runs N. 20° W. for "
            "240 feet, averaging 15 feet wide and 7 feet high. There is no stream in the cave."
        ),
        'total_length': 73.2,  # 240 ft ≈ 73m
        'water_present': False,
    },
    {
        'name': 'Eoff Cave',
        'latitude': dms(35, 32, 8, 'N'),
        'longitude': dms(85, 15, 25, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** 4 miles east of Wartrace, near Shiloh community, on the east bank "
            "of a tributary of Straight Creek, at an elevation of 980 feet.\n\n"
            "**Quadrangle:** Wartrace (78-SE)\n\n"
            "**Geologic Horizon:** Catheys formation\n\n"
            "Eoff Cave is 100 feet east of a secondary road. It is used as a local water supply. "
            "The entrance is 6 feet wide and 5 feet high. The cave runs N. 60° E. for 90 feet "
            "and is 6 feet wide and 6 feet high. It ends in a breakdown, which contains pieces "
            "of the Chattanooga shale. Near the end a 30-foot crawlway 5 feet above the stream "
            "extends S. 70° E."
        ),
        'total_length': 36.6,  # ~120 ft ≈ 37m
        'water_present': True,
        'water_description': 'Stream, used as local water supply',
    },
    {
        'name': 'Friddle Cave',
        'latitude': dms(35, 23, 27, 'N'),
        'longitude': dms(86, 25, 22, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** 0.8 mile west of Flat Creek Junction, in the valley of Goose Creek, "
            "on a hill 300 yards east of and 100 feet above the Goose Creek Road, at an "
            "elevation of 950 feet.\n\n"
            "**Quadrangle:** Shelbyville (79-NW)\n\n"
            "**Geologic Horizon:** Catheys formation\n\n"
            "Friddle Cave has a vertical entrance, a hole 28 feet deep and 6 feet in diameter. "
            "There are three branches to this cave. The main passage, into which the entrance "
            "shaft opens, averages 15 feet high and 20 feet wide. On one side it extends "
            "S. 20° E. for 90 feet and N. 80° W. for 75 feet farther to a breakdown. On the "
            "other side it runs northward for 100 feet, through a colonnade of large and "
            "beautiful columns and stalagmites. Near the end a low crawl leads into a small "
            "grotto. The third branch of the cave consists of a series of passages, some of "
            "them crawlways, which extends in a northwesterly direction for 375 feet. This "
            "branch averages 6 feet wide and 5 feet high. Recent exploration since the writer's "
            "visit has uncovered a passage three quarters of a mile or more in length."
        ),
        'total_length': 1414.0,  # 375+165+100+crawlways + 3/4 mile ≈ 1414m
        'vertical_extent': 8.5,  # 28 ft entrance shaft ≈ 8.5m
        'water_present': False,
    },
    {
        'name': 'Halliburton Cave',
        'latitude': dms(35, 34, 18, 'N'),
        'longitude': dms(86, 14, 58, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** 0.4 mile west of the Coffee County line, in the valley of Noah Fork, "
            "at the edge of a low hill 100 feet south of the Noah Fork Road, at an elevation "
            "of 860 feet.\n\n"
            "**Quadrangle:** Noah (85-SW)\n\n"
            "**Geologic Horizon:** Carters limestone\n\n"
            "Halliburton Cave is a network constructed along joint sets which strike N. 30° W. "
            "and N. 60° E. The average dimensions of the passageways are 6 feet high and 5 feet "
            "wide. The mouth is a small hole in the hillside, but it opens immediately into a "
            "passage 10 feet wide and 6 feet high. About 1,200 feet of this interesting cave was "
            "explored. Four parallel passages, which extend S. 60° W., are connected by smaller "
            "channels which follow the normal joints. Several attractive formations—small "
            "stalactites and a few large columns—were observed. Some old names are smoked on the "
            "ceiling near the back of the network. The entire cave is contained within a "
            "comparatively small hill, and the amount of overburden is only 10 to 20 feet."
        ),
        'total_length': 365.8,  # 1200 ft ≈ 366m
        'water_present': False,
    },
    {
        'name': 'Rippey Ridge Cave',
        'latitude': dms(35, 26, 58, 'N'),
        'longitude': dms(86, 18, 0, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** 0.65 mile south of Roseville, in the valley of Shipman Creek, on a "
            "northwest spur of Rippey Ridge, at an elevation of 910 feet.\n\n"
            "**Quadrangle:** Normandy (79-NE)\n\n"
            "**Geologic Horizon:** Catheys formation\n\n"
            "Rippey Ridge Cave was first explored February 12, 1956, by members of the Cumberland "
            "chapter of the National Speleological Society. The cave stream emerges from small "
            "openings at creek level at the base of Rippey Ridge, but the roofs of these tubular "
            "solution channels are too low to permit entrance. About 370 feet southeast of the "
            "cave spring, at an elevation of 910 feet, is a sinkhole which leads vertically "
            "downward for 70 feet into the cave. The last 40-foot pitch is sheer. At the bottom "
            "of the entrance shaft is a breakdown chamber 100 feet long, 25 feet wide, and 25 "
            "feet high. The main cave passage extends southeast for a surveyed distance of 3,322 "
            "feet and averages 30 feet high and 12 feet wide. The top half of the passage is "
            "smooth-walled, but the lower half has many scallops and pointed edges of the type "
            "usually found along rapidly moving free-surface streams. Two large domepits are found "
            "in the cave. The smaller of the two is 360 feet southeast of the entrance, in a "
            "short side passage. It extends upward for 65 feet and downward for 12 feet below the "
            "cave floor to a pool into which water falls. The large domepit occurs in the middle "
            "of the main passage 1,600 feet from the entrance. It is 30 feet in diameter and more "
            "than 100 feet high. A waterfall enters the domepit about 70 feet above the cave "
            "passage, but no pool is present at the bottom of the pit. Both domepits occur at "
            "points beneath the heads of hollows that cut into the Fort Payne chert cap of Rippey "
            "Ridge, and are clearly of secondary origin. The cave terminates in a series of three "
            "waterfall rooms and is finally blocked by a flowstone curtain. Gypsum flowers, some "
            "of them 6 inches long and 12 inches in diameter, occur in these rooms."
        ),
        'total_length': 1012.6,  # 3322 ft ≈ 1013m
        'vertical_extent': 30.5,  # 100 ft domepit ≈ 30.5m
        'water_present': True,
        'water_description': 'Cave stream, waterfalls, domepit pool',
        'requires_equipment': 'Rope and vertical gear for 70-foot entrance shaft',
    },
    {
        'name': 'Ray Cave',
        'latitude': dms(35, 26, 13, 'N'),
        'longitude': dms(86, 18, 11, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** In a sinkhole on top of Eddy Hill, 0.8 mile southeast of Willow "
            "Grove and 200 yards west of U. S. Hwy. 41-A, at an elevation of 1,020 feet.\n\n"
            "**Quadrangle:** Normandy (79-NE)\n\n"
            "**Geologic Horizon:** Catheys formation\n\n"
            "Ray Cave consists of a single gallery, 250 feet long, which trends southeast. Near "
            "the mouth the cave is 12 to 20 feet wide and 10 to 15 feet high. At the end is a "
            "large room 30 feet wide and 40 to 50 feet high. Water drips from the roof in many "
            "places and falls like rain in the final room. The floor of the cave is littered with "
            "breakdown, which includes Chattanooga shale and large blocks of chert."
        ),
        'total_length': 76.2,  # 250 ft ≈ 76m
        'vertical_extent': 15.2,  # 50 ft room ≈ 15m
        'water_present': True,
        'water_description': 'Dripping water, rain-like falls in terminal room',
    },
    {
        'name': 'Reese Cave',
        'latitude': dms(35, 22, 10, 'N'),
        'longitude': dms(86, 31, 2, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** 9 miles south of Shelbyville, on the east side of U. S. Hwy. 241, "
            "1.2 miles northeast of the Bedford-Moore-Lincoln County corner, at an elevation "
            "of 895 feet.\n\n"
            "**Quadrangle:** Belleville (72-SE)\n\n"
            "**Geologic Horizon:** Bigby-Cannon limestone\n\n"
            "This cave has two mouths. The south mouth, nearest the highway, is 8 feet wide and "
            "5 feet high. From this mouth the cave extends N. 70° E. for 135 feet to a point "
            "where dripstone nearly blocks the passage, then north for 165 feet to the second "
            "mouth, a low opening 2 feet high and 2 feet wide. A passage to the right just "
            "inside the roadside entrance extends S. 15° W. for 60 feet, then turns S. 15° E. "
            "for 75 feet farther to a pool. By wading one can continue for 120 feet farther to "
            "an upper room 50 feet wide, 30 feet long, and 15 feet high. A number of formations "
            "may be seen here, including a column 12 feet high and 2 feet in diameter. Three or "
            "four crawlways, probably communicating with the surface, lead off at the far side "
            "of this room. The passages in Reese Cave average about 10 feet wide and 8 feet high."
        ),
        'total_length': 168.6,  # ~555 ft ≈ 169m
        'water_present': True,
        'water_description': 'Pool requiring wading',
    },
    {
        'name': 'Shipman Creek Cave',
        'latitude': dms(35, 24, 55, 'N'),
        'longitude': dms(86, 17, 13, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** 1 mile northeast of Ledfords Mill, on the west bank of Shipman "
            "Creek, 200 yards west of the Shipman Creek Road, at an elevation of 920 feet.\n\n"
            "**Quadrangle:** Normandy (79-NE)\n\n"
            "**Geologic Horizon:** Catheys formation\n\n"
            "A wide stream flows through Shipman Creek Cave and emerges at the mouth, which is "
            "50 feet wide and 8 feet high. The mud in the bed of the stream is 3 feet deep or "
            "more. The cave runs southeast for 1,850 feet. The average dimensions are 20 feet "
            "wide and 8 feet high. Near the end is a room 20 feet wide, 20 feet high, and 150 "
            "feet long."
        ),
        'total_length': 563.9,  # 1850 ft ≈ 564m
        'water_present': True,
        'water_description': 'Wide stream flowing through entire cave, deep mud',
    },
    {
        'name': 'Ward Cave',
        'latitude': dms(35, 19, 54, 'N'),
        'longitude': dms(86, 25, 1, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** At the head of Ward Hollow, a tributary of Flat Creek, 1,500 feet "
            "west of the Moore County line, at an elevation of 920 feet.\n\n"
            "**Quadrangle:** Booneville (79-SW)\n\n"
            "**Geologic Horizon:** Catheys formation\n\n"
            "Ward Cave has two mouths, about 50 yards apart. The lower one is 30 feet wide and "
            "8 feet high. A large passage with a mud and gravel floor extends southeast from the "
            "mouth for 150 feet, then swings northeast for 120 feet, and then southeast for 200 "
            "feet farther. The last 150 feet is a crawlway in a gravelled stream bed. A high "
            "passage perpendicular to the main passage leads to a deep pool. Near the lower mouth "
            "a passage runs northwest for 285 feet, with two right-angle deviations into a joint "
            "set which strikes northeast-southwest. It finally intersects the room below the upper "
            "mouth. The upper entrance is 10 feet wide and 2 feet high, and drops sharply into "
            "this room, which is 20 feet high, 25 feet wide, and 75 feet long. In addition to "
            "the passage that connects with the lower mouth, a stream passage, for the most part "
            "a crawlway, extends N. 60° W. from the room. It may be followed for 400 feet in a "
            "northeasterly direction, to a dome 40 feet high and 15 feet in diameter. The stream "
            "that flows through this passage emerges at a spring between the mouths. Another cave "
            "opens 50 feet northwest of the lower mouth and is in the same sink. The mouth of "
            "this smaller cave is 8 feet wide and 4 feet high. The cave consists of about 200 "
            "feet of narrow, winding passageways 3 feet wide and 8 feet high, and it runs in a "
            "southeasterly direction. The passages become progressively smaller toward the back. "
            "No connection with Ward Cave is apparent."
        ),
        'total_length': 527.3,  # ~1730 ft ≈ 527m (main + connecting + stream passage + side cave)
        'vertical_extent': 12.2,  # 40 ft dome ≈ 12m
        'water_present': True,
        'water_description': 'Stream, deep pool, spring between mouths',
    },
    {
        'name': 'Yell Cave',
        'latitude': dms(35, 29, 29, 'N'),
        'longitude': dms(86, 15, 53, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** 0.85 mile southwest of Bedford Lake, on the west side of Doddy "
            "Creek, at an elevation of 860 feet.\n\n"
            "**Quadrangle:** Normandy (79-NE)\n\n"
            "**Geologic Horizon:** Bigby-Cannon limestone\n\n"
            "The principal entrance is a pitlike hole 20 feet in diameter and 20 feet deep. The "
            "stream flows beneath the floor of the entrance room, and passages extend westward "
            "(downstream) for 300 feet to an impenetrable breakdown and northeastward (upstream) "
            "for 250 feet or more. The northeast branch has a short upper level nearly blocked "
            "with flowstone. Eight hundred feet southwest another entrance opens above a spring, "
            "through which the cave stream emerges. A passage trends north-northeast for 250 "
            "feet to a point where the stream is ponded, beyond which exploration was not "
            "continued. The two caves are believed to be part of the same system."
        ),
        'total_length': 243.8,  # ~800 ft ≈ 244m
        'vertical_extent': 6.1,  # 20 ft entrance ≈ 6m
        'water_present': True,
        'water_description': 'Underground stream, ponded water, spring',
    },
    {
        'name': "Aaron Tollett's Cave",
        'latitude': dms(35, 44, 24, 'N'),
        'longitude': dms(85, 1, 24, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** 0.7 mile east of Litton, 1,000 feet east of the East Valley Road, "
            "and 0.6 mile southwest of Tollett Cemetery, at an elevation of 1,020 feet.\n\n"
            "**Quadrangle:** Melvine (110-NE)\n\n"
            "**Geologic Horizon:** Ridley limestone\n\n"
            "The entrance to this cave is a collapse sink 9 feet long, 6 feet wide and 8 feet "
            "deep. It opens into a gallery which averages 8 feet high and 10 feet wide. To the "
            "right the cave extends east for 150 feet, ending in breakdown. To the left it "
            "extends west for 60 feet, then N. 40° W. for 350 feet farther, continuing on into "
            "a low, wet crawlway. Some beautiful stalagmites and columns are developed in this "
            "fork, along a joint which may be seen in the ceiling of the cave. The overburden is "
            "only about 8 feet, and tree roots project from the roof in many places. A small "
            "stream flows through the left fork and is piped out of the cave through a hole in "
            "the roof near the entrance."
        ),
        'total_length': 170.7,  # ~560 ft ≈ 171m
        'water_present': True,
        'water_description': 'Small stream in left fork, piped out through roof',
    },
    {
        'name': 'Hamilton Cave',
        'latitude': dms(35, 31, 52, 'N'),
        'longitude': dms(85, 16, 45, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** 8 miles south of Pikeville and 0.5 mile west of the former site of "
            "old Sequatchie College, near the foot of the west wall of Sequatchie Valley, at an "
            "elevation of 960 feet.\n\n"
            "**Quadrangle:** Brockdell (103-SE)\n\n"
            "**Geologic Horizon:** Glen Dean limestone\n\n"
            "The entrance is 18 feet wide and 6 feet high. The cave extends west for 150 feet, "
            "with about the same dimensions as the entrance, to a fork. The right hand branch, "
            "which is 400 feet long, runs north, then northeast, and finally turns east. It is a "
            "crawl except for a 60-foot section near the end. This section is 5 feet high and 8 "
            "feet wide. Much digging has been done in the northeast branch of the cave. A stream "
            "flows out of the left fork and emerges below the cave entrance. The left fork is 5 "
            "feet high and 15 feet wide and is full of slab breakdown. It extends south for 30 "
            "feet, then turns west for another 60 feet, and ends in general collapse of the ceiling."
        ),
        'total_length': 195.1,  # ~640 ft ≈ 195m
        'water_present': True,
        'water_description': 'Stream in left fork, emerges below entrance',
    },
    {
        'name': 'Lowe Gap Cave',
        'latitude': dms(35, 43, 1, 'N'),
        'longitude': dms(85, 0, 44, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** On the north side of Lowe Gap, near the head of Swafford Hollow, 2 "
            "miles east of Litton, at an elevation of 1,020 feet.\n\n"
            "**Quadrangle:** Melvine (110-NE)\n\n"
            "**Geologic Horizon:** St. Louis limestone, dipping eastward at an angle of 10°\n\n"
            "Lowe Gap Cave opens high on a bluff overlooking a sharp turnback in the road that "
            "runs east from Litton. The mouth is 5 feet high and 6 feet wide and slopes downward "
            "into the main passage, which is 780 feet long. The cave heads south for 150 feet, "
            "then east, then northeast for the last 120 feet. It averages 8 feet wide and 9 feet "
            "high, though near the entrance the ceiling is 30 feet above the floor. The cave "
            "drops at an angle of 10° for 450 feet, apparently following a gentle dip in the "
            "limestone, then slowly ascends until a silt fill blocks further progress. At the "
            "deepest point the cave was estimated to be 80 feet below the level of the main "
            "entrance. There are four side passages, mostly narrow, sinuous crawls. A pool of "
            "water was found in one of them. They branch many times; one reenters the main cave, "
            "and another emerges to the exterior at the base of a low bluff 75 feet west of the "
            "main entrance, through a hole 12 inches high and 18 inches wide. These side "
            "passages total about 500 feet in length."
        ),
        'total_length': 390.1,  # 780 + 500 ft ≈ 390m
        'vertical_extent': 24.4,  # 80 ft below entrance ≈ 24m
        'water_present': True,
        'water_description': 'Pool in side passage',
    },
    {
        'name': 'Mill Branch Cave',
        'latitude': dms(35, 39, 37, 'N'),
        'longitude': dms(85, 5, 27, 'W'),
        'region': 'Tennessee',
        'country': 'United States',
        'description': (
            "**Location:** 0.4 mile southeast of the East Valley Road and 1.7 miles "
            "south-southwest of Red Hill Church, on the south side of a branch, at an elevation "
            "of 1,020 feet.\n\n"
            "**Quadrangle:** Melvine (110-NE)\n\n"
            "**Geologic Horizon:** Catheys formation\n\n"
            "Mill Branch Cave is a network cave, in a low hill, excavated along normal joint "
            "sets which strike N. 80° E. and N. 60° W. Two of the entrances are about 8 feet "
            "wide and 6 feet high and are connected by a passage 6 feet high, 10 feet wide, and "
            "150 feet long. The third entrance leads most directly into the main part of the "
            "cave. It is a small hole 18 inches high and 12 inches wide. Two high, N. 60° W. "
            "joint passages 30 feet high and 60 and 30 feet long, respectively, are in this "
            "section of the cave. They are 8 feet wide at the top and narrow to 2 feet wide at "
            "the bottom. The walls of these high galleries are covered with flowstone. The "
            "passage that connects this part of the cave with the other two entrances is only 10 "
            "inches high. The stream on which the cave is situated empties into Sequatchie River "
            "a mile and half southeast of the mouth of Mill Branch."
        ),
        'total_length': 73.2,  # ~240 ft mapped ≈ 73m
        'vertical_extent': 9.1,  # 30 ft high galleries ≈ 9m
        'water_present': True,
        'water_description': 'Stream on branch emptying into Sequatchie River',
    },
]


class Command(BaseCommand):
    help = 'Seed 14 Tennessee caves from historical survey data'

    def add_arguments(self, parser):
        parser.add_argument(
            '--owner', type=str, default=None,
            help='Username to set as cave owner (defaults to first superuser)',
        )

    def handle(self, *args, **options):
        # Find owner
        owner = None
        if options['owner']:
            try:
                owner = UserProfile.objects.get(username=options['owner'])
            except UserProfile.DoesNotExist:
                self.stderr.write(f'User "{options["owner"]}" not found')
                return
        else:
            owner = UserProfile.objects.filter(is_superuser=True).first()

        if owner:
            self.stdout.write(f'Owner: {owner.username}')
        else:
            self.stdout.write(self.style.WARNING('No owner set (no superuser found)'))

        created_count = 0
        skipped_count = 0

        for cave_data in CAVES:
            name = cave_data['name']
            cave, created = Cave.objects.get_or_create(
                name=name,
                defaults={
                    **cave_data,
                    'owner': owner,
                    'source': 'imported',
                    'visibility': 'public',
                },
            )
            if created:
                created_count += 1
                self.stdout.write(
                    f'  + {name} ({cave_data["latitude"]:.6f}, {cave_data["longitude"]:.6f})'
                )
            else:
                skipped_count += 1
                self.stdout.write(f'  = {name} (already exists)')

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS(
            f'Done! {created_count} caves created, {skipped_count} already existed.'
        ))
        self.stdout.write(f'Total caves in database: {Cave.objects.count()}')
