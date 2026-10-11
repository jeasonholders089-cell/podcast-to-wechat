# 插画提示词模板

## 用法

把 `{...}` 占位替换成本期内容后，交给 AI98 生图。竖版和方版**分开出**，不要裁。

## 通用风格段（固定）

```
Editorial illustration for a technology podcast cover.
Style: two-tone charcoal-and-cream printmaking, screen-print texture, subtle paper grain.
Palette: cream paper #F5F1E9, vermilion orange #E8552D, charcoal #2B2B2B. No other colors.
Composition: {VERTICAL_3x4 | SQUARE_1x1}, generous negative space in the upper third for headline text overlay.
```

## CRITICAL FACE REQUIREMENT（必须原样保留）

```
CRITICAL FACE REQUIREMENT: every person in the image MUST have a fully rendered face —
two clearly visible eyes with pupils, eyebrows, nose, and mouth. Faces must be drawn with
visible linework and shading, NOT blank, NOT a solid black silhouette, NOT a featureless
white shape. Both characters must be recognizable as human figures with distinct facial features.
```

> 旧产线在这里踩过坑：早期提示词写了 `faces generic and stylized, not any recognizable real person`，
> 模型读成「不用画五官」，于是脸要么空白要么纯黑剪影。**不要再用那句否定式描述。**

## 主体段（每期替换）

```
Scene: {GUEST_DESCRIPTION} seated across from a host holding a microphone,
leaning slightly forward mid-sentence. Background abstract geometry
{THEME_MOTIF}, one large orange circle partially cropped at the edge.
```

## 负面提示

```
no text, no letters, no watermark, no logo, no blank faces, no faceless figures,
no solid black head shapes, no extra limbs, no distorted hands
```

## 出图后

1. 肉眼看每张图的脸：有眼睛、有嘴、不是纯黑块
2. `python scripts/check_art_faces.py <期目录>`
3. 重出了插画 → **必须重合成贴图封面**
