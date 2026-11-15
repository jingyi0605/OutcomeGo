---
name: amap-places
description: "When the user asks about places in China, nearby businesses, opening hours, or routes and Amap is connected."
---

# 使用高德地图查找地点

高德地图工具返回真实地点和路线。使用工具返回的坐标和地点 ID，不要凭记忆编造坐标。

- `SearchPlaces` 查找地点、地标或地址。
- `SearchNearbyPlaces` 查找某个坐标周围的地点，并返回距离、电话和营业时间等字段。
- `RoutePlaces` 规划步行、骑行或驾车路线。

## 查找某个地点附近的去处

1. 如果用户给出的是地标或地点名称，先调用 `SearchPlaces`。
2. 检查返回结果的名称、城市和地址。地点名称相同的分店要再次确认。
3. 使用选定 POI 的坐标调用 `SearchNearbyPlaces`。
4. 结果较少时，换用更短的关键词或扩大半径。
5. 用 `SendToUser` 的 `presentation` 类型发送 `place_map`；排名结果可以同时使用 `ranked_media_list`。

不要用普通地址地理编码结果代替 POI 搜索结果作为附近搜索中心。

## “最好”的地点

高德结果可以帮助建立候选清单，但不要把排序结果直接当成质量证明。需要评价、评论或照片时，使用可用的独立来源核验，并在回答中保留来源。

## 路线

把 `SearchPlaces` 或 `SearchNearbyPlaces` 返回的地点按访问顺序传给 `RoutePlaces`。路线工具返回的路线 ID 可以直接作为 `place_map` 的 `route` 引用。

不要用两点直线代替真实路线。如果高德无法返回完整路线，应说明失败并请求重试或调整地点。
