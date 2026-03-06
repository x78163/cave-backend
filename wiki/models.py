import uuid
from django.conf import settings
from django.db import models
from django.utils.text import slugify


class Category(models.Model):
    """Hierarchical taxonomy for wiki articles."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    slug = models.SlugField(unique=True)
    description = models.TextField(blank=True, default='')
    icon = models.CharField(
        max_length=50, blank=True, default='',
        help_text='Emoji or icon class for display',
    )
    parent = models.ForeignKey(
        'self', on_delete=models.CASCADE,
        null=True, blank=True, related_name='children',
    )
    order = models.IntegerField(default=0, help_text='Sort order within parent')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'name']
        verbose_name_plural = 'categories'

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)


class ArticleTag(models.Model):
    """Tags for cross-cutting article classification."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)


class Article(models.Model):
    """A wiki article about any aspect of caving."""

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'
        UNDER_REVIEW = 'under_review', 'Under Review'
        ARCHIVED = 'archived', 'Archived'

    class Visibility(models.TextChoices):
        PUBLIC = 'public', 'Public'
        MEMBERS_ONLY = 'members_only', 'Members Only'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=300)
    slug = models.SlugField(max_length=320, unique=True)
    content = models.TextField(
        blank=True, default='',
        help_text='Markdown-formatted article content',
    )
    summary = models.TextField(
        blank=True, default='',
        help_text='Short abstract or lead paragraph',
    )
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='articles',
    )
    tags = models.ManyToManyField(ArticleTag, blank=True, related_name='articles')
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.DRAFT,
    )
    visibility = models.CharField(
        max_length=20, choices=Visibility.choices, default=Visibility.PUBLIC,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='wiki_articles_created',
    )
    last_edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='wiki_articles_edited',
    )
    source_cave = models.OneToOneField(
        'caves.Cave', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='wiki_article',
        help_text='Cave whose description auto-syncs into this article',
    )
    cave_description = models.TextField(
        blank=True, default='',
        help_text='Auto-synced from linked cave description (read-only in editor)',
    )
    is_locked = models.BooleanField(
        default=False, help_text='Prevent edits (admin only)',
    )
    featured_image = models.ImageField(
        upload_to='wiki/images/', null=True, blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['slug']),
            models.Index(fields=['status']),
            models.Index(fields=['category']),
        ]

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.title)
            # Ensure uniqueness
            base_slug = self.slug
            counter = 1
            while Article.objects.filter(slug=self.slug).exclude(pk=self.pk).exists():
                self.slug = f'{base_slug}-{counter}'
                counter += 1
        super().save(*args, **kwargs)


class ArticleRevision(models.Model):
    """Snapshot of article content for version history."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    article = models.ForeignKey(
        Article, on_delete=models.CASCADE, related_name='revisions',
    )
    content = models.TextField(help_text='Markdown content snapshot')
    edit_summary = models.CharField(max_length=300, blank=True, default='')
    editor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='wiki_revisions',
    )
    revision_number = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-revision_number']
        unique_together = ['article', 'revision_number']

    def __str__(self):
        return f'{self.article.title} — rev {self.revision_number}'


class ArticleLink(models.Model):
    """Cross-reference between an article and other entities."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source_article = models.ForeignKey(
        Article, on_delete=models.CASCADE, related_name='outgoing_links',
    )
    target_article = models.ForeignKey(
        Article, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='incoming_links',
    )
    target_cave = models.ForeignKey(
        'caves.Cave', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='wiki_references',
    )
    target_poi_type = models.CharField(
        max_length=20, blank=True, default='',
        help_text='POI type for bidirectional cave discovery (e.g., formation, biology)',
    )
    link_text = models.CharField(
        max_length=300, help_text='Display text used in the article',
    )
    auto_generated = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['link_text']

    def __str__(self):
        target = self.target_article or self.target_cave or self.target_poi_type
        return f'{self.source_article.title} → {target}'


class ArticleImage(models.Model):
    """Image uploaded for use in a wiki article."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    article = models.ForeignKey(
        Article, on_delete=models.CASCADE, related_name='images',
    )
    image = models.ImageField(upload_to='wiki/images/')
    caption = models.CharField(max_length=300, blank=True, default='')
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='wiki_images',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Image for {self.article.title}: {self.caption or "untitled"}'
