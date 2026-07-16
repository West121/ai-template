package com.xingchen.oa.boot.devstudio.repository;

import com.xingchen.oa.boot.devstudio.entity.DevAssetVersion;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface DevAssetVersionRepository extends JpaRepository<DevAssetVersion, Long> {

    List<DevAssetVersion> findByAssetTypeAndCodeOrderByVersionNoDesc(String assetType, String code);

    Optional<DevAssetVersion> findTopByAssetTypeAndCodeOrderByVersionNoDesc(String assetType, String code);

    Optional<DevAssetVersion> findByAssetTypeAndCodeAndVersionNo(String assetType, String code, Integer versionNo);
}
