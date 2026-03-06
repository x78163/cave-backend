from django.contrib import admin
from .models import Article, ArticleRevision, ArticleTag, ArticleLink, ArticleImage, Category


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'parent', 'order')
    prepopulated_fields = {'slug': ('name',)}
    list_editable = ('order',)


@admin.register(ArticleTag)
class ArticleTagAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug')
    prepopulated_fields = {'slug': ('name',)}


class ArticleRevisionInline(admin.TabularInline):
    model = ArticleRevision
    extra = 0
    readonly_fields = ('revision_number', 'editor', 'edit_summary', 'created_at')
    fields = ('revision_number', 'editor', 'edit_summary', 'created_at')


class ArticleLinkInline(admin.TabularInline):
    model = ArticleLink
    fk_name = 'source_article'
    extra = 0


class ArticleImageInline(admin.TabularInline):
    model = ArticleImage
    extra = 0


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ('title', 'slug', 'category', 'status', 'visibility', 'created_by', 'updated_at')
    list_filter = ('status', 'visibility', 'category')
    search_fields = ('title', 'content', 'summary')
    prepopulated_fields = {'slug': ('title',)}
    inlines = [ArticleRevisionInline, ArticleLinkInline, ArticleImageInline]
