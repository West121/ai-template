package com.hentor.oa.boot;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@SpringBootApplication(scanBasePackages = "com.hentor.oa")
@EnableJpaRepositories(basePackages = "com.hentor.oa")
@EntityScan(basePackages = "com.hentor.oa")
@ConfigurationPropertiesScan(basePackages = "com.hentor.oa")
public class OaApplication {

    public static void main(String[] args) {
        SpringApplication.run(OaApplication.class, args);
    }
}
