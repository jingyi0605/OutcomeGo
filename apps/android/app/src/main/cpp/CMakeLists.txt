cmake_minimum_required(VERSION 3.22.1)
project(openteam_opus LANGUAGES C CXX)

set(OPUS_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/vendor/opus")
file(GLOB CELT_SOURCES CONFIGURE_DEPENDS "${OPUS_ROOT}/celt/*.c")
file(GLOB SILK_SOURCES CONFIGURE_DEPENDS "${OPUS_ROOT}/silk/*.c" "${OPUS_ROOT}/silk/fixed/*.c")
file(GLOB OPUS_SOURCES CONFIGURE_DEPENDS "${OPUS_ROOT}/src/*.c")
list(FILTER CELT_SOURCES EXCLUDE REGEX ".*_demo\\.c$")
list(FILTER OPUS_SOURCES EXCLUDE REGEX ".*_(demo|compare)\\.c$")

add_library(opus STATIC ${CELT_SOURCES} ${SILK_SOURCES} ${OPUS_SOURCES})
target_include_directories(opus PRIVATE
    "${OPUS_ROOT}"
    "${OPUS_ROOT}/include"
    "${OPUS_ROOT}/celt"
    "${OPUS_ROOT}/silk"
    "${OPUS_ROOT}/silk/fixed"
    "${OPUS_ROOT}/dnn"
    "${OPUS_ROOT}/src"
)
target_compile_definitions(opus PRIVATE OPUS_BUILD FIXED_POINT USE_ALLOCA)
target_compile_options(opus PRIVATE -fvisibility=hidden -Wno-unused-parameter -Wno-sign-compare)

add_library(openteam_opus SHARED openteam_opus.cpp)
target_include_directories(openteam_opus PRIVATE "${OPUS_ROOT}/include")
target_link_libraries(openteam_opus opus log)
target_compile_features(openteam_opus PRIVATE cxx_std_17)
