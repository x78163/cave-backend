"""Serializers for the wiki app."""

from rest_framework import serializers

from .models import (
    Article, ArticleRevision, ArticleTag, ArticleLink,
    ArticleImage, Category,
)


class CategorySerializer(serializers.ModelSerializer):
    """Category with children count and optional nested children."""

    children = serializers.SerializerMethodField()
    article_count = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = [
            'id', 'name', 'slug', 'description', 'icon',
            'parent', 'order', 'children', 'article_count',
        ]
        read_only_fields = ['id']

    def get_children(self, obj):
        children = obj.children.all()
        if children.exists():
            return CategorySerializer(children, many=True).data
        return []

    def get_article_count(self, obj):
        return obj.articles.filter(status='published').count()


class ArticleTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = ArticleTag
        fields = ['id', 'name', 'slug']
        read_only_fields = ['id']


class ArticleRevisionSerializer(serializers.ModelSerializer):
    editor_username = serializers.CharField(
        source='editor.username', read_only=True, default=None,
    )

    class Meta:
        model = ArticleRevision
        fields = [
            'id', 'revision_number', 'content', 'edit_summary',
            'editor', 'editor_username', 'created_at',
        ]
        read_only_fields = ['id', 'revision_number', 'editor', 'created_at']


class ArticleLinkSerializer(serializers.ModelSerializer):
    target_article_title = serializers.CharField(
        source='target_article.title', read_only=True, default=None,
    )
    target_article_slug = serializers.CharField(
        source='target_article.slug', read_only=True, default=None,
    )
    target_cave_name = serializers.CharField(
        source='target_cave.name', read_only=True, default=None,
    )
    target_cave_id = serializers.UUIDField(
        source='target_cave.id', read_only=True, default=None,
    )

    class Meta:
        model = ArticleLink
        fields = [
            'id', 'link_text', 'auto_generated',
            'target_article', 'target_article_title', 'target_article_slug',
            'target_cave', 'target_cave_name', 'target_cave_id',
            'target_poi_type',
        ]


class ArticleImageSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.CharField(
        source='uploaded_by.username', read_only=True, default=None,
    )

    class Meta:
        model = ArticleImage
        fields = [
            'id', 'image', 'caption', 'uploaded_by',
            'uploaded_by_username', 'created_at',
        ]
        read_only_fields = ['id', 'uploaded_by', 'created_at']


class ArticleListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for article lists — no full content."""

    category_name = serializers.CharField(
        source='category.name', read_only=True, default=None,
    )
    category_slug = serializers.CharField(
        source='category.slug', read_only=True, default=None,
    )
    created_by_username = serializers.CharField(
        source='created_by.username', read_only=True, default=None,
    )
    last_edited_by_username = serializers.CharField(
        source='last_edited_by.username', read_only=True, default=None,
    )
    tags = ArticleTagSerializer(many=True, read_only=True)
    revision_count = serializers.SerializerMethodField()
    source_cave_id = serializers.UUIDField(
        source='source_cave.id', read_only=True, default=None,
    )
    source_cave_name = serializers.CharField(
        source='source_cave.name', read_only=True, default=None,
    )

    class Meta:
        model = Article
        fields = [
            'id', 'title', 'slug', 'summary', 'status', 'visibility',
            'category', 'category_name', 'category_slug',
            'tags', 'featured_image', 'is_locked',
            'source_cave_id', 'source_cave_name',
            'created_by', 'created_by_username',
            'last_edited_by', 'last_edited_by_username',
            'revision_count',
            'created_at', 'updated_at',
        ]

    def get_revision_count(self, obj):
        return obj.revisions.count()


class ArticleDetailSerializer(serializers.ModelSerializer):
    """Full article with content, tags, links, and revision info."""

    category_name = serializers.CharField(
        source='category.name', read_only=True, default=None,
    )
    category_slug = serializers.CharField(
        source='category.slug', read_only=True, default=None,
    )
    created_by_username = serializers.CharField(
        source='created_by.username', read_only=True, default=None,
    )
    last_edited_by_username = serializers.CharField(
        source='last_edited_by.username', read_only=True, default=None,
    )
    tags = ArticleTagSerializer(many=True, read_only=True)
    outgoing_links = ArticleLinkSerializer(many=True, read_only=True)
    incoming_links = serializers.SerializerMethodField()
    revision_count = serializers.SerializerMethodField()
    images = ArticleImageSerializer(many=True, read_only=True)
    can_edit = serializers.SerializerMethodField()
    source_cave_id = serializers.UUIDField(
        source='source_cave.id', read_only=True, default=None,
    )
    source_cave_name = serializers.CharField(
        source='source_cave.name', read_only=True, default=None,
    )

    class Meta:
        model = Article
        fields = [
            'id', 'title', 'slug', 'content', 'cave_description', 'summary',
            'status', 'visibility',
            'category', 'category_name', 'category_slug',
            'tags', 'featured_image', 'is_locked',
            'source_cave', 'source_cave_id', 'source_cave_name',
            'created_by', 'created_by_username',
            'last_edited_by', 'last_edited_by_username',
            'outgoing_links', 'incoming_links', 'images',
            'revision_count', 'can_edit',
            'created_at', 'updated_at',
        ]

    def get_incoming_links(self, obj):
        """Articles that link TO this article."""
        links = ArticleLink.objects.filter(
            target_article=obj,
        ).select_related('source_article')
        return [
            {
                'article_title': link.source_article.title,
                'article_slug': link.source_article.slug,
                'link_text': link.link_text,
            }
            for link in links
        ]

    def get_revision_count(self, obj):
        return obj.revisions.count()

    def get_can_edit(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        if obj.is_locked and not request.user.is_staff:
            return False
        return True


class ArticleCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating articles."""

    tag_ids = serializers.ListField(
        child=serializers.UUIDField(), write_only=True, required=False,
    )

    class Meta:
        model = Article
        fields = [
            'title', 'content', 'summary', 'category',
            'status', 'visibility', 'featured_image',
            'tag_ids',
        ]

    def create(self, validated_data):
        tag_ids = validated_data.pop('tag_ids', [])
        article = Article.objects.create(**validated_data)
        if tag_ids:
            article.tags.set(tag_ids)
        return article

    def update(self, instance, validated_data):
        tag_ids = validated_data.pop('tag_ids', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if tag_ids is not None:
            instance.tags.set(tag_ids)
        return instance
